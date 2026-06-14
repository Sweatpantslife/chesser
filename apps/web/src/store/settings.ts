import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BoardTheme = 'brown' | 'blue' | 'green' | 'gray';

interface SettingsState {
  sound: boolean;
  premove: boolean;
  boardTheme: BoardTheme;
  setSound(b: boolean): void;
  setPremove(b: boolean): void;
  setBoardTheme(t: BoardTheme): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      sound: true,
      premove: true,
      boardTheme: 'brown',
      setSound: (sound) => set({ sound }),
      setPremove: (premove) => set({ premove }),
      setBoardTheme: (boardTheme) => set({ boardTheme }),
    }),
    { name: 'chesser-settings' },
  ),
);
