import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls({ interactive }: { interactive: boolean }) {
  const handleClose = () => {
    if (interactive) void getCurrentWindow().close();
  };

  const handleMinimize = () => {
    if (interactive) void getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    if (interactive) void getCurrentWindow().toggleMaximize();
  };

  return (
    <div className="window-controls" aria-hidden={!interactive}>
      <button aria-label="Close window" className="close" disabled={!interactive} type="button" onClick={handleClose} />
      <button aria-label="Minimize window" className="minimize" disabled={!interactive} type="button" onClick={handleMinimize} />
      <button aria-label="Maximize window" className="maximize" disabled={!interactive} type="button" onClick={handleToggleMaximize} />
    </div>
  );
}
