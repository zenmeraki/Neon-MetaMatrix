import { create } from "zustand";

export const useAppUiStore = create((set) => ({
  isSyncing: false,
  setIsSyncing: (isSyncing) => set({ isSyncing: Boolean(isSyncing) }),
}));

export const selectIsSyncing = (state) => state.isSyncing;
export const selectSetIsSyncing = (state) => state.setIsSyncing;
