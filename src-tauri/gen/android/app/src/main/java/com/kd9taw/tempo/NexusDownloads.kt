package com.kd9taw.tempo

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.os.Looper
import android.provider.MediaStore
import java.io.IOException

/** Original Nexus public-export transport. Creates a NEW MediaStore row: no existing
 * document, private log, settings, credentials or radio state is read or modified.
 * Caller runs off the UI thread. Pending rows are not published until readback agrees.
 */
object NexusDownloads {
  @JvmStatic
  fun save(context: Context, name: String, bytes: ByteArray, mime: String): String {
    check(Looper.myLooper() != Looper.getMainLooper()) { "Downloads I/O must not block Stop controls" }
    require(name.isNotBlank() && name != "." && name != ".." &&
      name.none { it == '/' || it == '\\' || it.code < 32 || it.code == 127 } &&
      name.toByteArray(Charsets.UTF_8).size <= 200) { "Invalid export file name" }
    require(mime == "text/plain" || mime == "image/png") { "Unsupported export content type" }
    val resolver = context.applicationContext.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, mime)
      put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Nexus")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IOException("Android refused to create a Downloads document")
    try {
      resolver.openOutputStream(uri, "w")?.use { stream -> stream.write(bytes) }
        ?: throw IOException("Android did not open the export document for writing")
      // Closing the writer and successful readback must precede publication/success.
      verify(context, uri, bytes)
      val published = resolver.update(uri, ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }, null, null)
      if (published != 1) throw IOException("Android did not publish the complete export")
      return uri.toString()
    } catch (error: Throwable) {
      try {
        if (resolver.delete(uri, null, null) != 1) {
          error.addSuppressed(IOException("Android did not remove the incomplete pending export"))
        }
      } catch (cleanup: Throwable) { error.addSuppressed(cleanup) }
      throw error
    }
  }

  private fun verify(context: Context, uri: android.net.Uri, bytes: ByteArray) {
    val input = context.applicationContext.contentResolver.openInputStream(uri)
      ?: throw IOException("Android did not open the export for verification")
    input.use { stream ->
      val chunk = ByteArray(65536)
      var position = 0
      while (position < bytes.size) {
        val count = stream.read(chunk, 0, minOf(chunk.size, bytes.size - position))
        if (count <= 0) throw IOException("Android export readback is incomplete")
        for (index in 0 until count) {
          if (chunk[index] != bytes[position + index]) throw IOException("Android export readback differs")
        }
        position += count
      }
      if (stream.read() != -1) throw IOException("Android export readback has unexpected trailing bytes")
    }
  }
}
