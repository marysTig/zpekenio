import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { getLocalPrintDeviceId, PRINT_SETTINGS_ROW_ID } from "@/lib/printDevice";

type PrintSettingsState = {
  primaryDeviceId: string;
  loading: boolean;
  setPrimaryDeviceId: (id: string) => void;
  setLoading: (loading: boolean) => void;
};

const usePrintSettingsGlobal = create<PrintSettingsState>((set) => ({
  primaryDeviceId: "",
  loading: true,
  setPrimaryDeviceId: (primaryDeviceId) => set({ primaryDeviceId }),
  setLoading: (loading) => set({ loading }),
}));

let _initialized = false;

async function fetchPrintSettings(): Promise<{
  primaryDeviceId: string;
}> {
  const { data, error } = await supabase
    .from("print_settings")
    .select("primary_device_id")
    .eq("id", PRINT_SETTINGS_ROW_ID)
    .maybeSingle();

  if (error) {
    console.error("[print_settings] load error:", error.message);
    return { primaryDeviceId: "" };
  }
  return {
    primaryDeviceId: (data?.primary_device_id as string | undefined) ?? "",
  };
}

async function _initPrintSettings(
  setPrimaryDeviceId: (id: string) => void,
  setLoading: (l: boolean) => void,
) {
  if (_initialized) return;
  _initialized = true;

  setLoading(true);
  const s = await fetchPrintSettings();
  setPrimaryDeviceId(s.primaryDeviceId);
  setLoading(false);

  supabase
    .channel("print-settings-global")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "print_settings" },
      async () => {
        const next = await fetchPrintSettings();
        setPrimaryDeviceId(next.primaryDeviceId);
      },
    )
    .subscribe();
}

export function usePrintSettingsStore() {
  const {
    primaryDeviceId,
    loading,
    setPrimaryDeviceId,
    setLoading,
  } = usePrintSettingsGlobal();

  useEffect(() => {
    _initPrintSettings(setPrimaryDeviceId, setLoading);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const localDeviceId = getLocalPrintDeviceId();
  const isPrimaryHub =
    !!primaryDeviceId && primaryDeviceId === localDeviceId;

  const claimPrimaryHub = useCallback(async () => {
    const deviceId = getLocalPrintDeviceId();
    const { error } = await supabase.from("print_settings").upsert(
      {
        id: PRINT_SETTINGS_ROW_ID,
        primary_device_id: deviceId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    setPrimaryDeviceId(deviceId);
    return deviceId;
  }, [setPrimaryDeviceId]);

  const reload = useCallback(async () => {
    setLoading(true);
    const s = await fetchPrintSettings();
    setPrimaryDeviceId(s.primaryDeviceId);
    setLoading(false);
  }, [setPrimaryDeviceId, setLoading]);

  return {
    primaryDeviceId,
    localDeviceId,
    isPrimaryHub,
    loading,
    claimPrimaryHub,
    reload,
  };
}

export function getPrimaryDeviceIdFromStore(): string {
  return usePrintSettingsGlobal.getState().primaryDeviceId;
}

export function isLocalDevicePrimaryHub(): boolean {
  const primary = usePrintSettingsGlobal.getState().primaryDeviceId;
  return !!primary && primary === getLocalPrintDeviceId();
}
