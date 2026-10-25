package com.kd9taw.tempo

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import java.io.File
import java.io.IOException
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

/** Actual product exporter + ContentResolver/real temporary file descriptors.
 * Only MediaStore's system provider is modeled. No OS Downloads app, JNI, Tauri,
 * native engine, device permission flow or RF is exercised by these tests.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NexusDownloadsTest {
  private lateinit var context: Context
  private lateinit var provider: ExportProvider

  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    provider = ExportProvider(File(context.cacheDir, "download-test-${System.nanoTime()}").apply { mkdirs() })
    provider.attachInfo(context, ProviderInfo().apply { authority = "media" })
    ShadowContentResolver.registerProviderInternal("media", provider)
  }

  private fun save(name: String, bytes: ByteArray, mime: String = "text/plain"): String {
    val task = FutureTask(Callable { NexusDownloads.save(context, name, bytes, mime) })
    Thread(task, "export-test-worker").start()
    try { return task.get(10, TimeUnit.SECONDS) }
    catch (error: ExecutionException) { throw (error.cause ?: error) }
  }

  @Test fun verifiedTextPublishesOnlyAfterClosedWriterAndReadback() {
    val data = "<CALL:6>BG0AAA<COMMENT:6>你好<EOR>".toByteArray(Charsets.UTF_8)
    val uri = Uri.parse(save("nexus-log.adi", data))
    assertArrayEquals(data, provider.rows.getValue(uri).readBytes())
    assertEquals(listOf("insert:1", "open:w", "open:r", "publish:0"), provider.operations)
    assertEquals("Download/Nexus", provider.lastValues!!.getAsString(MediaStore.MediaColumns.RELATIVE_PATH))
    assertEquals("text/plain", provider.lastValues!!.getAsString(MediaStore.MediaColumns.MIME_TYPE))
    assertEquals(MediaStore.Downloads.EXTERNAL_CONTENT_URI, provider.collection)
    assertEquals(0, provider.deleted)
  }

  @Test fun imageAndMultiChunkExportsKeepEveryActualByte() {
    val data = ByteArray(131089) { (it % 251).toByte() }
    val uri = Uri.parse(save("journey.png", data, "image/png"))
    assertArrayEquals(data, provider.rows.getValue(uri).readBytes())
    assertEquals("image/png", provider.lastValues!!.getAsString(MediaStore.MediaColumns.MIME_TYPE))
  }

  @Test fun emptyExportsAreStillVerifiedAndPublished() {
    val uri = Uri.parse(save("empty.txt", byteArrayOf()))
    assertEquals(0L, provider.rows.getValue(uri).length())
    assertTrue(provider.operations.contains("open:r"))
    assertTrue(provider.operations.contains("publish:0"))
  }

  @Test fun repeatedNameCreatesNewDocumentWithoutTruncatingEarlierExport() {
    val first = Uri.parse(save("same.adi", "original".toByteArray()))
    val second = Uri.parse(save("same.adi", "new".toByteArray()))
    assertNotEquals(first, second)
    assertEquals("original", provider.rows.getValue(first).readText())
    assertEquals("new", provider.rows.getValue(second).readText())
  }

  @Test fun corruptedReadbackNeverPublishesAndDeletesThePendingDocument() {
    provider.readback = "corrupted"
    assertThrows(IOException::class.java) { save("log.adi", "original".toByteArray()) }
    assertEquals(1, provider.deleted)
    assertTrue(provider.rows.isEmpty())
    assertFalse(provider.operations.contains("publish:0"))
  }

  @Test fun shortOrTrailingReadbackIsNotSuccess() {
    for (bad in listOf("orig", "original-extra")) {
      provider.readback = bad
      assertThrows(IOException::class.java) { save("log.adi", "original".toByteArray()) }
      assertTrue(provider.rows.isEmpty())
      assertFalse(provider.operations.contains("publish:0"))
    }
    assertEquals(2, provider.deleted)
  }

  @Test fun refusedCreateWriteReadOrPublishNeverReturnsSuccess() {
    provider.refuseInsert = true
    assertThrows(IOException::class.java) { save("log.adi", byteArrayOf(1)) }
    assertEquals(0, provider.deleted)
    provider.refuseInsert = false
    provider.refuseWrite = true
    assertThrows(IOException::class.java) { save("log.adi", byteArrayOf(1)) }
    provider.refuseWrite = false
    provider.refuseRead = true
    assertThrows(IOException::class.java) { save("log.adi", byteArrayOf(1)) }
    provider.refuseRead = false
    provider.refusePublish = true
    assertThrows(IOException::class.java) { save("log.adi", byteArrayOf(1)) }
    assertEquals(3, provider.deleted)
    assertTrue(provider.rows.isEmpty())
  }

  @Test fun unsafeNamesAndUnknownContentTypesFailBeforeProviderAccess() {
    for (name in listOf("", " ", ".", "..", "../log.adi", "folder/log.adi", "folder\\log.adi", "bad\u0000.adi", "a".repeat(201))) {
      assertThrows(IllegalArgumentException::class.java) { save(name, byteArrayOf()) }
    }
    assertThrows(IllegalArgumentException::class.java) { save("file.bin", byteArrayOf(), "application/foreign") }
    assertTrue(provider.operations.isEmpty())
  }

  @Test fun uiThreadRefusesDiskIoRatherThanBlockingStopControls() {
    assertThrows(IllegalStateException::class.java) { NexusDownloads.save(context, "file.txt", byteArrayOf(), "text/plain") }
    assertTrue(provider.operations.isEmpty())
  }
}

/** Test-only OS provider boundary, real ContentResolver and file I/O above it. */
class ExportProvider(private val root: File) : ContentProvider() {
  val rows = linkedMapOf<Uri, File>()
  val operations = mutableListOf<String>()
  var lastValues: ContentValues? = null
  var collection: Uri? = null
  var deleted = 0
  var readback: String? = null
  var refuseInsert = false
  var refuseWrite = false
  var refuseRead = false
  var refusePublish = false
  private var next = 1

  override fun onCreate() = true
  override fun getType(uri: Uri): String = "text/plain"
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, order: String?): Cursor? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? {
    if (refuseInsert) return null
    collection = uri
    lastValues = ContentValues(values!!)
    operations.add("insert:${values.getAsInteger(MediaStore.MediaColumns.IS_PENDING)}")
    val id = next++
    val created = Uri.withAppendedPath(uri, id.toString())
    rows[created] = File(root, "row-$id").apply { writeBytes(byteArrayOf()) }
    return created
  }
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    operations.add("open:$mode")
    val file = rows.getValue(uri)
    if (mode.startsWith("w")) {
      if (refuseWrite) throw IOException("test write refused")
      return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_TRUNCATE)
    }
    if (refuseRead) throw IOException("test read refused")
    readback?.let { file.writeText(it) }
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }
  override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?): Int {
    operations.add("publish:${values!!.getAsInteger(MediaStore.MediaColumns.IS_PENDING)}")
    return if (refusePublish) 0 else if (rows.containsKey(uri)) 1 else 0
  }
  override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int {
    val file = rows.remove(uri) ?: return 0
    deleted++
    file.delete()
    return 1
  }
}
