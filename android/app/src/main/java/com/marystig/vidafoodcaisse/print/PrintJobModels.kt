package com.marystig.vidafoodcaisse.print

import org.json.JSONObject

data class NativePrintJob(
  val id: String,
  val jobType: String,
  val priority: Int,
  val printerId: String?,
  val printerName: String?,
  val macAddress: String?,
  val attemptCount: Int,
  val payload: JSONObject,
  val tableId: String?,
) {
  val escposBase64: String?
    get() = payload.optString("escposBase64", "").takeIf { it.isNotBlank() }

  companion object {
    fun fromJson(row: JSONObject): NativePrintJob {
      val payload = row.optJSONObject("payload") ?: JSONObject()
      return NativePrintJob(
        id = row.getString("id"),
        jobType = row.optString("job_type", "receipt"),
        priority = row.optInt("priority", 100),
        printerId = row.optString("printer_id", null),
        printerName = row.optString("printer_name", null),
        macAddress = row.optString("mac_address", null)?.trim()?.takeIf { it.isNotEmpty() },
        attemptCount = row.optInt("attempt_count", 0),
        payload = payload,
        tableId = payload.optString("tableId", null)?.takeIf { it.isNotBlank() }
          ?: row.optString("table_id", null)?.takeIf { it.isNotBlank() },
      )
    }
  }
}
