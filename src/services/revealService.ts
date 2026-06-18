import { invoke } from '@tauri-apps/api/core';

export async function revealInFileManager(path: string): Promise<void> {
  await invoke('reveal_in_file_manager', { path });
}
