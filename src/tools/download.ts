// Hand generated text to the browser's download, and ask for a name first.
import type { ToolContext } from './tool';

export function downloadText(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

interface SaveHandle { createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }
type SavePicker = (o: { suggestedName: string }) => Promise<SaveHandle>;

/** The browser's own Save As, where it has one. Cancelling it is not an error. True once the file is written. */
async function saveWithPicker(ctx: ToolContext, picker: SavePicker, name: string, text: string): Promise<boolean> {
  try {
    const out = await (await picker({ suggestedName: name })).createWritable();
    await out.write(text);
    await out.close();
    ctx.message(`Saved ${name}`);
    return true;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') ctx.message(`Could not save: ${(e as Error).message}`, 'warn');
    return false;
  }
}

/** Ask for a name, then download. `extension` includes the dot. `onSaved` runs once the file has been handed over. */
export function askNameAndSave(
  ctx: ToolContext, title: string, initial: string, extension: string, type: string, text: string, onSaved?: () => void,
): void {
  let name: { get(): string } | null = null;
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker?.bind(window);
  const d = ctx.dialogs.open({
    title,
    okLabel: 'Save',
    onOk: () => {
      const chosen = (name as { get(): string }).get().trim();
      if (!chosen) return false;
      const file = chosen.toLowerCase().endsWith(extension) ? chosen : `${chosen}${extension}`;
      if (picker && ask?.get()) void saveWithPicker(ctx, picker, file, text).then((done) => { if (done) onSaved?.(); });
      else {
        downloadText(file, text, type);
        onSaved?.();
      }
      return true;
    },
    onChange: () => d.setOkEnabled(!!name?.get().trim()),
  });
  name = d.text('Name', initial.replace(/[^\w.-]+/g, '_'));
  // [ref GUID-BC1A5C26 "specify a location"]. Only some browsers let a page do this; the rest use their downloads folder.
  const ask = picker ? d.checkbox('Choose Location', false) : null;
}
