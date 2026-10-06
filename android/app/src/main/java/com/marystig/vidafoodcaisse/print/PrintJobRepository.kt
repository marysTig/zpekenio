package com.marystig.vidafoodcaisse.print

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Supabase PostgREST client for print_jobs (receipt-only drain).
 */
class PrintJobRepository(
  private val baseUrl: String,
  private val anonKey: String,
  private val deviceId: String,
) {
  private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(20, TimeUnit.SECONDS)
    .build()

  private val jsonMedia = "application/json".toMediaType()
  private val rest = "$baseUrl/rest/v1"

  companion object {
    private const val TAG = "PrintJobRepo"
    /** Single-printer profile — keep in sync with JS kitchenPrintQueue. */
    const val MAX_ATTEMPTS = 3
    const val RETRY_BACKOFF_MS = 2500L
    const val RECEIPT_RETRY_BACKOFF_MS = 450L
  }

  private fun authHeaders(builder: Request.Builder): Request.Builder =
    builder
      .header("apikey", anonKey)
      .header("Authorization", "Bearer $anonKey")
      .header("Prefer", "return=representation")

  private fun nowIso(): String {
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    sdf.timeZone = TimeZone.getTimeZone("UTC")
    return sdf.format(Date())
  }

  private fun isoAfter(msFromNow: Long): String {
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    sdf.timeZone = TimeZone.getTimeZone("UTC")
    return sdf.format(Date(System.currentTimeMillis() + msFromNow))
  }

  private fun get(path: String): String {
    val req = authHeaders(Request.Builder().url("$rest$path").get()).build()
    client.newCall(req).execute().use { resp ->
      val body = resp.body?.string().orEmpty()
      if (!resp.isSuccessful) {
        throw IllegalStateException("GET $path → ${resp.code}: $body")
      }
      return body
    }
  }

  private fun patch(path: String, json: JSONObject): String {
    val req = authHeaders(
      Request.Builder()
        .url("$rest$path")
        .patch(json.toString().toRequestBody(jsonMedia)),
    ).build()
    client.newCall(req).execute().use { resp ->
      val body = resp.body?.string().orEmpty()
      if (!resp.isSuccessful) {
        throw IllegalStateException("PATCH $path → ${resp.code}: $body")
      }
      return body
    }
  }

  fun countActiveJobs(): Int {
    return try {
      val body = get(
        "/print_jobs?select=id&status=in.(pending,printing)&limit=50",
      )
      JSONArray(body).length()
    } catch (e: Exception) {
      Log.w(TAG, "countActiveJobs failed", e)
      0
    }
  }

  fun hasPendingReceipt(): Boolean {
    val body = get(
      "/print_jobs?select=id&job_type=eq.receipt&status=in.(pending,printing)&limit=1",
    )
    return JSONArray(body).length() > 0
  }

  fun reclaimPrintingForDevice() {
    val now = nowIso()
    val patchBody = JSONObject()
      .put("status", "pending")
      .put("claimed_by_device_id", JSONObject.NULL)
      .put("next_attempt_at", now)
      .put("updated_at", now)
      .put("error", "Worker restarted")
    try {
      patch(
        "/print_jobs?status=eq.printing&job_type=eq.receipt&claimed_by_device_id=eq.$deviceId",
        patchBody,
      )
      Log.i(TAG, "reclaimed printing jobs for $deviceId")
    } catch (e: Exception) {
      Log.w(TAG, "reclaim failed", e)
    }
  }

  /** Release printing rows older than [staleMs] (any device) — mirrors JS reclaimStale. */
  fun reclaimStalePrinting(staleMs: Long = 90_000L) {
    val cutoff = isoAfter(-staleMs)
    val patchBody = JSONObject()
      .put("status", "pending")
      .put("claimed_by_device_id", JSONObject.NULL)
      .put("next_attempt_at", nowIso())
      .put("updated_at", nowIso())
      .put("error", "Stale printing reclaim")
    try {
      val result = patch(
        "/print_jobs?status=eq.printing&job_type=eq.receipt&updated_at=lt.$cutoff",
        patchBody,
      )
      val n = try {
        JSONArray(result).length()
      } catch (_: Exception) {
        0
      }
      if (n > 0) Log.i(TAG, "reclaimed $n stale printing job(s)")
    } catch (e: Exception) {
      Log.w(TAG, "stale reclaim failed", e)
    }
  }

  fun claimNext(): NativePrintJob? {
    // OkHttp HttpUrl encodes query values — pass raw ISO, do not pre-encode.
    val now = nowIso()
    cancelLegacyKitchenJobs()
    val path =
      "/print_jobs?select=*&status=eq.pending&job_type=eq.receipt" +
        "&next_attempt_at=lte.$now&order=priority.desc,created_at.asc&limit=5"
    val candidates = JSONArray(get(path))
    if (candidates.length() == 0) return null

    for (i in 0 until candidates.length()) {
      val row = candidates.getJSONObject(i)
      val id = row.getString("id")
      val update = JSONObject()
        .put("status", "printing")
        .put("claimed_by_device_id", deviceId)
        .put("updated_at", nowIso())
        .put("error", JSONObject.NULL)
      try {
        val result = patch(
          "/print_jobs?id=eq.$id&status=eq.pending",
          update,
        )
        val arr = JSONArray(result)
        if (arr.length() > 0) {
          return NativePrintJob.fromJson(arr.getJSONObject(0))
        }
      } catch (e: Exception) {
        Log.w(TAG, "claim race on $id", e)
      }
    }
    return null
  }

  /** Cancel leftover kitchen jobs so they never touch Bluetooth. */
  fun cancelLegacyKitchenJobs() {
    try {
      val result = patch(
        "/print_jobs?job_type=eq.kitchen&status=in.(pending,printing,needs_manual)",
        JSONObject()
          .put("status", "cancelled")
          .put("error", "Cuisine désactivée — ticket ignoré")
          .put("claimed_by_device_id", JSONObject.NULL)
          .put("updated_at", nowIso()),
      )
      val n = try {
        JSONArray(result).length()
      } catch (_: Exception) {
        0
      }
      if (n > 0) Log.i(TAG, "cancelled $n legacy kitchen job(s)")
    } catch (e: Exception) {
      Log.w(TAG, "cancel kitchen failed", e)
    }
  }

  fun cancelJob(jobId: String, message: String) {
    try {
      patch(
        "/print_jobs?id=eq.$jobId",
        JSONObject()
          .put("status", "cancelled")
          .put("error", message)
          .put("claimed_by_device_id", JSONObject.NULL)
          .put("updated_at", nowIso()),
      )
    } catch (e: Exception) {
      Log.w(TAG, "cancelJob failed", e)
    }
  }

  fun markDone(jobId: String) {
    val now = nowIso()
    patch(
      "/print_jobs?id=eq.$jobId",
      JSONObject()
        .put("status", "done")
        .put("printed_at", now)
        .put("updated_at", now)
        .put("error", JSONObject.NULL),
    )
  }

  fun requeueInterrupted(jobId: String) {
    patch(
      "/print_jobs?id=eq.$jobId&status=eq.printing",
      JSONObject()
        .put("status", "pending")
        .put("next_attempt_at", nowIso())
        .put("claimed_by_device_id", JSONObject.NULL)
        .put("error", "Interrompu pour ticket caisse")
        .put("updated_at", nowIso()),
    )
  }

  /** @return "pending" or "needs_manual" */
  fun scheduleRetry(
    jobId: String,
    attemptCount: Int,
    message: String,
    backoffMs: Long,
  ): String {
    if (attemptCount >= MAX_ATTEMPTS) {
      patch(
        "/print_jobs?id=eq.$jobId",
        JSONObject()
          .put("status", "needs_manual")
          .put("attempt_count", attemptCount)
          .put("error", message)
          .put("claimed_by_device_id", JSONObject.NULL)
          .put("updated_at", nowIso()),
      )
      return "needs_manual"
    }
    patch(
      "/print_jobs?id=eq.$jobId",
      JSONObject()
        .put("status", "pending")
        .put("attempt_count", attemptCount)
        .put("next_attempt_at", isoAfter(backoffMs))
        .put("error", message)
        .put("claimed_by_device_id", JSONObject.NULL)
        .put("updated_at", nowIso()),
    )
    return "pending"
  }

  fun retryAllNeedsManual(): Int {
    val now = nowIso()
    val result = patch(
      "/print_jobs?status=eq.needs_manual&job_type=eq.receipt",
      JSONObject()
        .put("status", "pending")
        .put("attempt_count", 0)
        .put("next_attempt_at", now)
        .put("claimed_by_device_id", JSONObject.NULL)
        .put("error", JSONObject.NULL)
        .put("updated_at", now),
    )
    return try {
      JSONArray(result).length()
    } catch (_: Exception) {
      0
    }
  }

  fun heartbeat(jobId: String) {
    try {
      patch(
        "/print_jobs?id=eq.$jobId&status=eq.printing",
        JSONObject().put("updated_at", nowIso()),
      )
    } catch (e: Exception) {
      Log.w(TAG, "heartbeat failed", e)
    }
  }
}
