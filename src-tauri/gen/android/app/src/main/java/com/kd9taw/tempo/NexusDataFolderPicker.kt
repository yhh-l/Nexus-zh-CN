package com.kd9taw.tempo

import android.app.Activity
import android.app.AlertDialog
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.ArrayAdapter
import java.io.File
import java.util.Locale

/** A real filesystem browser for Android-owned app directories, never a SAF URI converter.
 * Only selection and explicit new-directory creation happen here; station data is not opened,
 * moved or adopted. The existing Rust adoption/copy policy still owns that operation.
 */
internal class NexusDataFolderPicker(
    private val activity: Activity,
    initial: String,
    private val result: (String?, String?) -> Unit,
) {
    internal data class Root(val directory: File, val label: String)
    private data class Entry(val label: String, val directory: File?, val root: Root?)

    companion object {
        internal fun contains(root: File, directory: File): Boolean =
            directory.canonicalFile.toPath().startsWith(root.canonicalFile.toPath())

        internal fun roots(activity: Activity): List<Root> {
            val candidates = mutableListOf(
                Root(activity.filesDir.canonicalFile, activity.getString(R.string.nexus_folder_internal))
            )
            activity.getExternalFilesDirs(null).forEachIndexed { index, file ->
                if (file != null && file.isDirectory && file.canRead() && file.canWrite()) {
                    candidates.add(Root(file.canonicalFile, activity.getString(R.string.nexus_folder_external, index + 1)))
                }
            }
            return candidates.distinctBy { it.directory.path }
        }
    }

    private val roots = roots(activity)
    private var root: Root? = null
    private var current: File? = null
    private var done = false
    private var dialog: AlertDialog? = null
    private var newFolderDialog: AlertDialog? = null
    private var entries: List<Entry> = emptyList()
    private lateinit var location: TextView
    private lateinit var listing: ListView

    init {
        val start = runCatching { File(initial).canonicalFile }.getOrNull()
        if (start != null && start.isDirectory) {
            root = roots.firstOrNull { contains(it.directory, start) }
            if (root != null) current = start
        }
    }

    fun show() {
        check(!done && dialog == null)
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, 0)
        }
        panel.addView(TextView(activity).apply { setText(R.string.nexus_folder_scope) })
        location = TextView(activity).apply { setTextIsSelectable(true) }
        panel.addView(location)
        listing = ListView(activity).apply { id = android.R.id.list }
        panel.addView(listing, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, listHeight()))
        listing.setOnItemClickListener { _, _, index, _ ->
            val selected = entries.getOrNull(index) ?: return@setOnItemClickListener
            root = selected.root
            current = selected.directory
            refresh()
        }
        dialog = AlertDialog.Builder(activity)
            .setTitle(R.string.nexus_folder_title)
            .setView(panel)
            .setPositiveButton(R.string.nexus_folder_select, null)
            .setNeutralButton(R.string.nexus_folder_create, null)
            .setNegativeButton(android.R.string.cancel) { _, _ -> cancel() }
            .setOnCancelListener { cancel() }
            .setOnDismissListener { if (!done) cancel() }
            .create()
        dialog!!.show()
        dialog!!.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val selected = current
            val selectedRoot = root
            if (selected == null || selectedRoot == null) return@setOnClickListener
            try {
                check(contains(selectedRoot.directory, selected) && selected.isDirectory && selected.canWrite())
                finish(selected.canonicalPath, null)
            } catch (_: Exception) {
                fail(activity.getString(R.string.nexus_folder_unavailable))
            }
        }
        dialog!!.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { createDirectory() }
        refresh()
    }

    private fun listHeight(): Int =
        (activity.windowManager.currentWindowMetrics.bounds.height() * 0.4f).toInt()
            .coerceAtLeast((48 * activity.resources.displayMetrics.density).toInt())

    fun resize() {
        if (!done && this::listing.isInitialized) {
            listing.layoutParams = listing.layoutParams.apply { height = listHeight() }
        }
    }

    private fun refresh() {
        try {
            val selected = current
            val selectedRoot = root
            entries = if (selected == null || selectedRoot == null) {
                location.text = activity.getString(R.string.nexus_folder_roots)
                roots.map { Entry(it.label, it.directory, it) }
            } else {
                check(contains(selectedRoot.directory, selected) && selected.isDirectory)
                location.text = selected.canonicalPath
                val up = if (selected.canonicalFile == selectedRoot.directory) {
                    Entry(activity.getString(R.string.nexus_folder_roots), null, null)
                } else {
                    Entry("..", selected.parentFile, selectedRoot)
                }
                val children = selected.listFiles() ?: throw IllegalStateException("Storage unavailable")
                listOf(up) + children.filter {
                    it.isDirectory && it.canRead() && contains(selectedRoot.directory, it)
                }.sortedBy { it.name.lowercase(Locale.ROOT) }.map { Entry(it.name, it.canonicalFile, selectedRoot) }
            }
            listing.adapter = ArrayAdapter(activity, android.R.layout.simple_list_item_1, entries.map { it.label })
            dialog?.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = selected != null && selected.canWrite()
            dialog?.getButton(AlertDialog.BUTTON_NEUTRAL)?.isEnabled = selected != null && selected.canWrite()
        } catch (_: Exception) {
            fail(activity.getString(R.string.nexus_folder_unavailable))
        }
    }

    private fun createDirectory() {
        val parent = current ?: return
        val selectedRoot = root ?: return
        val input = EditText(activity).apply { id = android.R.id.edit; isSingleLine = true }
        val prompt = AlertDialog.Builder(activity)
            .setTitle(R.string.nexus_folder_create)
            .setView(input)
            .setPositiveButton(android.R.string.ok, null)
            .setNegativeButton(android.R.string.cancel, null)
            .create()
        newFolderDialog = prompt
        prompt.setOnDismissListener { if (newFolderDialog === prompt) newFolderDialog = null }
        prompt.show()
        prompt.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val name = input.text.toString().trim()
            if (name.isEmpty() || name == "." || name == ".." || name.any { it == '/' || it == '\\' || it.isISOControl() }) {
                input.error = activity.getString(R.string.nexus_folder_invalid_name)
                return@setOnClickListener
            }
            try {
                val child = File(parent, name)
                check(contains(selectedRoot.directory, child))
                check(!child.exists() && child.mkdir())
                current = child.canonicalFile
                prompt.dismiss()
                refresh()
            } catch (_: Exception) {
                input.error = activity.getString(R.string.nexus_folder_create_failed)
            }
        }
    }

    fun cancel() = finish(null, null)
    fun fail(message: String) = finish(null, message)

    private fun finish(path: String?, error: String?) {
        if (done) return
        done = true
        newFolderDialog?.dismiss()
        dialog?.dismiss()
        result(path, error)
    }
}
