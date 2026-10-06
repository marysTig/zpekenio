# Phase 1 — Native Hub Print Worker

Status: **implemented** (single Caisse printer — receipts only).

## Goal

Move Bluetooth RFCOMM I/O and `print_jobs` drain out of the WebView into a
native Android Foreground Service so the hub prints 24/7 regardless of login,
minimize, or WebView throttle.

## Architecture

```
React UI ──enqueueReceipt──► Supabase print_jobs (receipt)
     │
     └── HubPrintWorkerPlugin (start/stop/status/retry/admin)
                    │
                    ▼
         HubPrintWorkerService (FGS CONNECTED_DEVICE)
                    │
         SingleThreadExecutor (FIFO)
                    │
         EscPosBluetoothPrinter (RFCOMM SPP) — one Caisse MAC
```

When the native worker is running (`isNativePrintWorkerActive()`), JS
`PrintQueueDaemon` does **not** call `bluetoothCoordinator` / `bluetoothSerial`.
UI only enqueues + shows status. Phase 0 remains the fallback if start fails.

Legacy `job_type=kitchen` rows are cancelled and never printed.

## Kotlin components

| File | Purpose |
|------|---------|
| `HubPrintWorkerService.kt` | FGS `CONNECTED_DEVICE`; notification with queue depth + last error |
| `print/PrintJobRepository.kt` | Claim/update via Supabase PostgREST; cancels legacy kitchen jobs |
| `print/EscPosBluetoothPrinter.kt` | Insecure RFCOMM UUID `00001101-0000-1000-8000-00805F9B34FB` |
| `print/PrintWorkerLoop.kt` | FIFO loop; receipt-only; admin probe/test on same executor |
| `HubPrintWorkerPlugin.kt` | Capacitor: `startWorker`, `stopWorker`, `getWorkerStatus`, `triggerManualRetry`, `wakeWorker`, `adminProbe`, `adminTestPrint` |
| `src/lib/hubPrintWorkerPlugin.ts` | Capacitor TS bridge; auto-start when `isPrimaryHub` |

## Cutover

- Android primary hub → `HubForegroundSync` calls `startNativePrintWorker()` with
  `deviceId` + `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- Credentials persisted in SharedPreferences for `START_STICKY` restart.
- Native REST poll: 500ms busy / 1500ms idle (no native Realtime).

## QA checklist

- [x] Native FGS starts on primary hub; `nativeDrainActive=true`
- [x] JS `PrintQueueDaemon` idles Bluetooth when native owns drain
- [x] Native claims receipt jobs only; kitchen jobs cancelled
- [ ] Hub logged out prints caisse receipts (needs printer powered/in range)
- [ ] App minimized / screen off for 5+ minutes still drains queue
- [ ] Kill app → FGS restart → reclaim + resume
- [ ] Offline Supabase → jobs remain pending; resume on reconnect
- [ ] Admin probe/test while worker running (same executor)
