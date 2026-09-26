import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Crop,
  Download,
  FileImage,
  HelpCircle,
  ImagePlus,
  LockKeyhole,
  Maximize,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createDemo } from "./demo";
import { exportPng, loadImage, normalizeBox, renderCanvas } from "./lib/image";
import type { Box, LoadedImage, Redaction, Watermark } from "./lib/image";

type Edits = { covers: Redaction[]; crop: Box | null; watermark: Watermark };
type History = { past: Edits[]; current: Edits; future: Edits[] };
const initialEdits = (): Edits => ({
  covers: [],
  crop: null,
  watermark: {
    enabled: false,
    text: "仅供本次沟通使用",
    opacity: 0.2,
    color: "#202a3c",
  },
});
const colors = ["#202a3c", "#ffffff", "#f0a372"];
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <header>
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export default function App() {
  const [source, setSource] = useState<LoadedImage | null>(null);
  const sourceRef = useRef<LoadedImage | null>(null);
  const [name, setName] = useState("");
  const [history, setHistory] = useState<History>({
    past: [],
    current: initialEdits(),
    future: [],
  });
  const [mode, setMode] = useState<"cover" | "crop">("cover");
  const [color, setColor] = useState(colors[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const revision = useRef(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState(false);
  const [offline, setOffline] = useState(false);
  const [confirm, setConfirm] = useState<{
    file?: File;
    close?: boolean;
  } | null>(null);
  const [review, setReview] = useState<{
    url: string;
    blob: Blob;
    width: number;
    height: number;
    revision: number;
    count: number;
  } | null>(null);
  const [hovering, setHovering] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sequence = useRef(0);
  const drag = useRef<{ x: number; y: number; mode: "cover" | "crop" } | null>(
    null,
  );
  const edit = history.current;
  const currentCover = edit.covers.find((c) => c.id === selected);

  function change(next: Edits) {
    if (busyRef.current) return;
    revision.current++;
    setPreviewReady(false);
    setHistory((h) => ({
      past: [...h.past.slice(-49), h.current],
      current: next,
      future: [],
    }));
    setDirty(true);
    setError("");
  }
  function undo() {
    if (busyRef.current) return;
    revision.current++;
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            current: h.past[h.past.length - 1],
            future: [h.current, ...h.future],
          }
        : h,
    );
    setSelected(null);
    setDraft(null);
    setDirty(true);
  }
  function redo() {
    if (busyRef.current) return;
    revision.current++;
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.current],
            current: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
    setSelected(null);
    setDirty(true);
  }
  function closeImage() {
    revision.current++;
    setPreviewReady(false);
    sequence.current++;
    sourceRef.current?.bitmap.close();
    sourceRef.current = null;
    setSource(null);
    setName("");
    setDirty(false);
    setSelected(null);
    setDraft(null);
    setHistory({ past: [], current: initialEdits(), future: [] });
    setConfirm(null);
  }
  async function openFile(file: File) {
    const seq = ++sequence.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setConfirm(null);
    try {
      const next = await loadImage(file);
      if (seq !== sequence.current) {
        next.bitmap.close();
        return;
      }
      revision.current++;
      setPreviewReady(false);
      sourceRef.current?.bitmap.close();
      sourceRef.current = next;
      setSource(next);
      setName(file.name);
      setHistory({ past: [], current: initialEdits(), future: [] });
      setDraft(null);
      setSelected(null);
      setZoom(100);
      setMode("cover");
      setDirty(false);
    } catch (e) {
      if (seq === sequence.current)
        setError(
          e instanceof Error
            ? e.message
            : "图片读取失败，请选择有效的 PNG 或 JPEG。",
        );
    } finally {
      if (seq === sequence.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function requestFile(file: File) {
    if (busyRef.current || review || help || confirm) return;
    if (source && dirty) setConfirm({ file });
    else void openFile(file);
  }
  function acceptFiles(files: FileList | File[] | null) {
    if (files?.length) {
      if (files.length > 1) setNotice("每次处理一张图片，已选择第一张。");
      requestFile(files[0]);
    }
  }
  function point(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * source!.width,
      y: ((e.clientY - rect.top) / rect.height) * source!.height,
    };
  }
  function pointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (
      !source ||
      busyRef.current ||
      !previewReady ||
      (e.pointerType === "mouse" && e.button !== 0)
    )
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { ...point(e), mode };
    setSelected(null);
  }
  function pointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current && source)
      setDraft(
        normalizeBox(drag.current, point(e), source.width, source.height),
      );
  }
  function pointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || !source) return;
    const box = normalizeBox(
      drag.current,
      point(e),
      source.width,
      source.height,
    );
    const tool = drag.current.mode;
    drag.current = null;
    setDraft(null);
    if (box.width < 3 || box.height < 3) {
      setNotice("请按住并拖动，框出需要处理的区域。");
      return;
    }
    if (tool === "crop") change({ ...edit, crop: box });
    else {
      const id = crypto.randomUUID();
      change({ ...edit, covers: [...edit.covers, { ...box, color, id }] });
      setSelected(id);
    }
  }
  function cancelDrag() {
    drag.current = null;
    setDraft(null);
  }
  function editCover(box: Partial<Redaction>) {
    if (currentCover)
      change({
        ...edit,
        covers: edit.covers.map((c) =>
          c.id === selected ? { ...c, ...box } : c,
        ),
      });
  }
  function deleteCover(id: string) {
    change({ ...edit, covers: edit.covers.filter((c) => c.id !== id) });
    setSelected(null);
  }
  async function prepareExport() {
    if (!source || busyRef.current || !previewReady) return;
    const exportRevision = revision.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const blob = await exportPng(
        source.bitmap,
        source.width,
        source.height,
        edit.covers,
        edit.crop,
        edit.watermark,
      );
      setReview({
        blob,
        url: URL.createObjectURL(blob),
        width: edit.crop?.width ?? source.width,
        height: edit.crop?.height ?? source.height,
        revision: exportRevision,
        count: edit.covers.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败，请缩小图片后重试。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function closeReview() {
    if (review) {
      const url = review.url;
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    setReview(null);
  }
  function saveExport() {
    if (!review) return;
    const a = document.createElement("a");
    a.href = review.url;
    a.download = `zheji-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.png`;
    a.click();
    if (revision.current === review.revision) setDirty(false);
    setNotice(
      "已发起 PNG 下载。请打开下载文件再核对一次，并只分享这张新图片。",
    );
  }

  useEffect(() => {
    if (!source || !canvasRef.current) return;
    try {
      const out = renderCanvas(
        source.bitmap,
        source.width,
        source.height,
        edit.covers,
        null,
        edit.watermark,
      );
      const target = canvasRef.current;
      target.width = out.width;
      target.height = out.height;
      target.getContext("2d")!.drawImage(out, 0, 0);
      out.width = 0;
      out.height = 0;
      setPreviewReady(true);
    } catch (e) {
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
      setPreviewReady(false);
      setError(e instanceof Error ? e.message : "预览失败。");
    }
  }, [source, edit]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        help ||
        review ||
        confirm
      )
        return;
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        acceptFiles(e.clipboardData.files);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !source ||
        help ||
        review ||
        confirm ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if (e.key === "Escape") {
        cancelDrag();
        setSelected(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        deleteCover(selected);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const ready = () => setOffline(true);
    window.addEventListener("zheji-offline-ready", ready);
    if (import.meta.env.PROD && "serviceWorker" in navigator)
      navigator.serviceWorker.ready.then(ready).catch(() => {});
    return () => window.removeEventListener("zheji-offline-ready", ready);
  }, []);
  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(id);
    }
  }, [notice]);
  useEffect(
    () => () => {
      sourceRef.current?.bitmap.close();
    },
    [],
  );

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (!help && !review && !confirm) setHovering(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setHovering(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setHovering(false);
        if (!help && !review && !confirm) acceptFiles(e.dataTransfer.files);
      }}
    >
      <header className="site-header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <strong>遮迹</strong>
          <span>ZHEJI</span>
          <i />
          图片隐私工作台
        </a>
        <div className="header-right">
          <span className="local-pill">
            <span />
            {offline ? "离线已就绪" : "仅在本机处理"}
          </span>
          <button className="text-button" onClick={() => setHelp(true)}>
            <HelpCircle size={16} />
            使用指南
          </button>
          <a
            href="https://github.com/FuzzyLogic112/zheji"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> A LITTLE LESS EXPOSED.
            </div>
            <h1>
              分享之前，<em>留一点隐私。</em>
            </h1>
            <p>
              框住不想公开的信息，加一句用途说明。原图留给自己，处理后的图片放心核对。
            </p>
          </div>
          <div className="intro-note">
            <ShieldCheck size={25} />
            <div>
              <strong>图片始终留在你的设备</strong>
              <span>无需上传 · 无需账户 · 无 AI 调用</span>
            </div>
          </div>
        </section>
        <div className="workflow">
          <span className={source ? "complete" : "current"}>
            <b>{source ? <Check size={12} /> : "1"}</b>选择图片
          </span>
          <i />
          <span className={source ? "current" : ""}>
            <b>2</b>遮盖与整理
          </span>
          <i />
          <span>
            <b>3</b>核对后导出
          </span>
          <small>
            <LockKeyhole size={13} />
            原图不会被修改
          </small>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button
              className="icon-button"
              aria-label="关闭错误提示"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <section className="editor-shell">
          <div className="editor-area">
            <div className="toolbar">
              <div className="tools">
                <button
                  className={mode === "cover" ? "tool selected" : "tool"}
                  disabled={!source || busy}
                  onClick={() => setMode("cover")}
                  title="拖出矩形遮盖区域"
                >
                  <Square size={17} />
                  遮盖
                </button>
                <button
                  className={mode === "crop" ? "tool selected" : "tool"}
                  disabled={!source || busy}
                  onClick={() => setMode("crop")}
                >
                  <Crop size={17} />
                  裁剪
                </button>
                <span className="separator" />
                <button
                  className="icon-button"
                  aria-label="撤销"
                  title="撤销 Ctrl+Z"
                  disabled={!source || !history.past.length || busy}
                  onClick={undo}
                >
                  <Undo2 size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="重做"
                  title="重做 Ctrl+Shift+Z"
                  disabled={!source || !history.future.length || busy}
                  onClick={redo}
                >
                  <Redo2 size={18} />
                </button>
              </div>
              <div className="zoom-controls">
                <button
                  className="icon-button"
                  aria-label="缩小预览"
                  disabled={!source || zoom <= 50}
                  onClick={() => setZoom((z) => z - 25)}
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  className="zoom-label"
                  disabled={!source}
                  onClick={() => setZoom(100)}
                >
                  {zoom === 100 ? "适应画布" : `${zoom}%`}
                </button>
                <button
                  className="icon-button"
                  aria-label="放大预览"
                  disabled={!source || zoom >= 250}
                  onClick={() => setZoom((z) => z + 25)}
                >
                  <ZoomIn size={16} />
                </button>
              </div>
            </div>
            <div
              className={`workspace ${source ? "has-image" : ""} ${hovering ? "dragging" : ""}`}
            >
              {!source ? (
                <div className="upload-state">
                  <div className="picture-art" aria-hidden="true">
                    <div className="mini-photo back" />
                    <div className="mini-photo front">
                      <div className="picture-mountains" />
                      <span className="mask-stripe" />
                      <div className="mini-lock">
                        <LockKeyhole size={21} />
                      </div>
                    </div>
                    <span className="art-spark">✦</span>
                  </div>
                  <h2>
                    把图片放在这里，
                    <br />
                    把隐私留在本机。
                  </h2>
                  <p>拖入图片、从剪贴板粘贴，或点击选择</p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus size={18} />
                    {busy ? "正在读取…" : "选择一张图片"}
                  </button>
                  <small>PNG / JPEG · 最大 20 MiB · 不超过 2000 万像素</small>
                  <button
                    className="demo-link"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      createDemo()
                        .then((file) => {
                          setBusy(false);
                          requestFile(file);
                        })
                        .catch(() => {
                          setBusy(false);
                          setError("无法生成示例图片。");
                        });
                    }}
                  >
                    先用虚构示例试一试 <ArrowRight size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="canvas-scroller">
                    <div
                      className="canvas-layout"
                      style={{
                        width: `calc(var(--preview-height) * ${source.width / source.height} * ${zoom / 100})`,
                        maxWidth: zoom <= 100 ? "100%" : undefined,
                      }}
                    >
                      <div
                        className="canvas-wrap"
                        style={{
                          aspectRatio: `${source.width}/${source.height}`,
                        }}
                        onPointerDown={pointerDown}
                        onPointerMove={pointerMove}
                        onPointerUp={pointerUp}
                        onPointerCancel={cancelDrag}
                        onLostPointerCapture={cancelDrag}
                        tabIndex={0}
                        role="img"
                        aria-label={`图片编辑区，${source.width}×${source.height} 像素。拖动添加${mode === "cover" ? "遮盖" : "裁剪"}区域，也可用右侧区域数值操作。`}
                      >
                        <canvas ref={canvasRef} />
                        <svg
                          className="editor-overlay"
                          viewBox={`0 0 ${source.width} ${source.height}`}
                          aria-hidden="true"
                        >
                          {edit.crop && (
                            <>
                              <path
                                d={`M0 0H${source.width}V${source.height}H0Z M${edit.crop.x} ${edit.crop.y}v${edit.crop.height}h${edit.crop.width}v-${edit.crop.height}Z`}
                                fill="#202a3c"
                                fillOpacity=".48"
                                fillRule="evenodd"
                              />
                              <rect
                                {...edit.crop}
                                fill="none"
                                stroke="#f0a372"
                                strokeWidth="2"
                                strokeDasharray="7 5"
                                vectorEffect="non-scaling-stroke"
                              />
                            </>
                          )}
                          {currentCover && (
                            <rect
                              x={currentCover.x - 2}
                              y={currentCover.y - 2}
                              width={currentCover.width + 4}
                              height={currentCover.height + 4}
                              fill="none"
                              stroke="#f0a372"
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          {draft && (
                            <rect
                              {...draft}
                              fill={mode === "cover" ? color : "#f0a372"}
                              fillOpacity={mode === "cover" ? 1 : 0.15}
                              stroke="#ed9560"
                              strokeWidth="2"
                              strokeDasharray="5 4"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className="canvas-hint">
                    <MousePointer2 size={13} />
                    {mode === "cover"
                      ? "按住并拖动，框住需要遮盖的内容"
                      : "拖出需要保留的区域，深色范围不会导出"}
                    <span>手机可在图片外滑动页面</span>
                  </div>
                </>
              )}
              {hovering && (
                <div className="drop-overlay">
                  <Upload size={32} />
                  <strong>松开，开始处理这张图片</strong>
                </div>
              )}
            </div>
            <div className="image-status">
              <span>
                <FileImage size={14} />
                {source ? (
                  <>
                    <b title={name}>{name}</b>
                    <i />
                    {source.width} × {source.height} px
                  </>
                ) : (
                  "还没有选择图片"
                )}
              </span>
              {source && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  更换图片 <ArrowUpRight size={12} />
                </button>
              )}
            </div>
          </div>
          <aside className="settings">
            <div className="settings-heading">
              <ScanLine size={18} />
              <h2>分享前，整理一下</h2>
            </div>
            <section className="setting-section">
              <div className="section-title">
                <h3>
                  <span>01</span>遮住敏感内容
                </h3>
                <span className="badge">不透明遮盖</span>
              </div>
              <p className="setting-description">
                头像、姓名、电话、地址、二维码……
                <br />
                框选区域会被纯色像素覆盖。
              </p>
              <div className="color-row">
                <span>遮盖颜色</span>
                <div>
                  {colors.map((c) => (
                    <button
                      key={c}
                      style={{ background: c }}
                      className={color === c ? "swatch selected" : "swatch"}
                      aria-label={`遮盖颜色 ${c}`}
                      aria-pressed={color === c}
                      onClick={() => {
                        setColor(c);
                        if (currentCover) editCover({ color: c });
                      }}
                    >
                      {color === c && (
                        <Check
                          size={12}
                          color={c === "#202a3c" ? "#fff" : "#202a3c"}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="region-label">
                <span>
                  已添加 <b>{edit.covers.length}</b> 个区域
                </span>
                <button
                  className="text-button"
                  disabled={!source || busy}
                  onClick={() => {
                    if (!source) return;
                    const id = crypto.randomUUID();
                    const width = Math.max(1, Math.round(source.width / 3));
                    const height = Math.max(1, Math.round(source.height / 12));
                    change({
                      ...edit,
                      covers: [
                        ...edit.covers,
                        {
                          id,
                          color,
                          x: Math.floor((source.width - width) / 2),
                          y: Math.floor((source.height - height) / 2),
                          width,
                          height,
                        },
                      ],
                    });
                    setSelected(id);
                  }}
                >
                  <Plus size={13} />
                  精确添加
                </button>
              </div>
              {edit.covers.length > 0 ? (
                <div className="region-list">
                  {edit.covers.map((c, i) => (
                    <div
                      className={
                        selected === c.id ? "region selected" : "region"
                      }
                      key={c.id}
                    >
                      <button onClick={() => setSelected(c.id)}>
                        <span style={{ background: c.color }} />
                        区域 {i + 1}
                        <small>
                          {c.width} × {c.height}
                        </small>
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`删除区域 ${i + 1}`}
                        onClick={() => deleteCover(c.id)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-regions">
                  <Square size={15} />
                  在图片上拖动即可添加
                </div>
              )}
              {currentCover && source && (
                <div className="coordinates">
                  {(["x", "y", "width", "height"] as const).map((key, i) => (
                    <label key={`${currentCover.id}-${key}`}>
                      {["左侧 X", "顶部 Y", "宽度", "高度"][i]}
                      <input
                        type="number"
                        aria-label={
                          ["区域左侧 X", "区域顶部 Y", "区域宽度", "区域高度"][
                            i
                          ]
                        }
                        key={`${currentCover.id}-${currentCover[key]}`}
                        defaultValue={currentCover[key]}
                        min={key === "width" || key === "height" ? 1 : 0}
                        max={
                          key === "x" || key === "width"
                            ? source.width
                            : source.height
                        }
                        onBlur={(e) => {
                          const v = e.target.valueAsNumber;
                          if (!Number.isFinite(v) || !Number.isInteger(v)) {
                            e.target.value = String(currentCover[key]);
                            return;
                          }
                          const box = { ...currentCover, [key]: v };
                          if (
                            box.x < 0 ||
                            box.y < 0 ||
                            box.width < 1 ||
                            box.height < 1 ||
                            box.x + box.width > source.width ||
                            box.y + box.height > source.height
                          ) {
                            e.target.value = String(currentCover[key]);
                            setNotice(
                              "区域需完整位于图片内，且宽高至少为 1 像素。",
                            );
                            return;
                          }
                          if (v !== currentCover[key]) editCover({ [key]: v });
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>
            <section className="setting-section">
              <div className="section-title">
                <h3>
                  <span>02</span>裁掉无关部分
                </h3>
                <button
                  className="text-button"
                  disabled={!source || busy}
                  onClick={() => setMode("crop")}
                >
                  <Crop size={14} />
                  框选
                </button>
              </div>
              <div className="crop-status">
                {edit.crop ? (
                  <>
                    <span>
                      {edit.crop.width} × {edit.crop.height} px
                    </span>
                    <button
                      className="text-button"
                      onClick={() => change({ ...edit, crop: null })}
                    >
                      取消裁剪
                    </button>
                  </>
                ) : (
                  <span>默认保留整张图片</span>
                )}
              </div>
            </section>
            <section className="setting-section watermark-section">
              <div className="section-title">
                <h3>
                  <span>03</span>标明使用用途
                </h3>
                <label className="toggle">
                  <input
                    type="checkbox"
                    aria-label="启用用途水印"
                    disabled={!source}
                    checked={edit.watermark.enabled}
                    onChange={(e) =>
                      change({
                        ...edit,
                        watermark: {
                          ...edit.watermark,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <span />
                </label>
              </div>
              <label className="watermark-input">
                <Type size={15} />
                <input
                  aria-label="用途水印文字"
                  placeholder="例如：仅供本次租房沟通使用"
                  disabled={!source}
                  maxLength={80}
                  value={edit.watermark.text}
                  onChange={(e) =>
                    change({
                      ...edit,
                      watermark: { ...edit.watermark, text: e.target.value },
                    })
                  }
                />
              </label>
              <div className="opacity-row">
                <label htmlFor="watermark-opacity">水印深浅</label>
                <input
                  id="watermark-opacity"
                  type="range"
                  min="10"
                  max="50"
                  step="5"
                  disabled={!source || !edit.watermark.enabled}
                  value={edit.watermark.opacity * 100}
                  onChange={(e) =>
                    change({
                      ...edit,
                      watermark: {
                        ...edit.watermark,
                        opacity: Number(e.target.value) / 100,
                      },
                    })
                  }
                />
                <span>{Math.round(edit.watermark.opacity * 100)}%</span>
              </div>
              <p className="small-note">
                水印用于说明用途，不保证防止转发或再次截图。
              </p>
            </section>
            <div className="export-section">
              <div className="export-summary">
                <ShieldCheck size={17} />
                <div>
                  <strong>导出一张新的 PNG</strong>
                  <p>遮盖写入像素 · 不复制原图元数据</p>
                </div>
              </div>
              <button
                className="button primary full"
                disabled={!source || busy || !previewReady || !!draft}
                onClick={prepareExport}
              >
                <ArrowDownToLine size={17} />
                {busy ? "正在处理…" : "核对并导出"}
                <ArrowRight size={16} />
              </button>
              <p>导出前，请自行检查是否还有遗漏。</p>
            </div>
          </aside>
        </section>
        <footer className="page-footer">
          <div>
            <span>
              <LockKeyhole size={13} />
              本地处理
            </span>
            <span>
              <CheckCheck size={14} />
              不修改原文件
            </span>
            <span>MIT 开源</span>
          </div>
          <p>
            图片只保留在本页内存中，关闭或刷新后需要重新选择。
            <button
              className="text-button"
              disabled={!source || busy}
              onClick={() =>
                dirty ? setConfirm({ close: true }) : closeImage()
              }
            >
              清空当前图片
            </button>
          </p>
        </footer>
      </main>
      <input
        ref={fileRef}
        aria-label="选择图片文件"
        className="hidden-file"
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        onChange={(e) => {
          acceptFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {confirm && (
        <Dialog title="当前修改还没有导出" onClose={() => setConfirm(null)}>
          <div className="dialog-body">
            <p>继续后将清除当前图片的编辑记录。原始图片文件不会被修改。</p>
            <div className="dialog-actions">
              <button className="button" onClick={() => setConfirm(null)}>
                返回继续处理
              </button>
              <button
                className="button primary"
                onClick={() =>
                  confirm.file ? void openFile(confirm.file) : closeImage()
                }
              >
                {confirm.file ? "放弃修改并更换" : "放弃修改并清空"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {review && (
        <Dialog title="最后看一眼，再分享" onClose={closeReview}>
          <div className="review-body">
            <div className="review-image">
              <img
                src={review.url}
                alt="即将导出的 PNG，请检查图片中是否仍有可识别的信息"
              />
            </div>
            <div className="review-details">
              <span>
                <Check size={14} />
                {review.count} 个遮盖区域
              </span>
              <span>
                {review.width} × {review.height} px
              </span>
              <span>{(review.blob.size / 1024).toFixed(0)} KB · PNG</span>
            </div>
            <p>
              这里展示的是即将下载的文件。请检查姓名、地址、头像、二维码及聊天内容中的线索；工具不会自动识别遗漏。
            </p>
            <button className="button primary full" onClick={saveExport}>
              <Download size={17} />
              下载这张 PNG
            </button>
            <button className="button text-button full" onClick={closeReview}>
              返回继续调整
            </button>
          </div>
        </Dialog>
      )}
      {help && (
        <Dialog title="让分享更有分寸" onClose={() => setHelp(false)}>
          <div className="dialog-body help-content">
            <ol>
              <li>
                <strong>选择图片。</strong>支持静态 PNG 和
                JPEG，可拖入、选取或从剪贴板粘贴。每次处理一张。
              </li>
              <li>
                <strong>遮盖敏感区域。</strong>
                在图片上按住拖动，或点“精确添加”后填写坐标。不透明色块会写入导出的像素，编辑边框不会导出。
              </li>
              <li>
                <strong>按需裁剪、加水印。</strong>
                裁剪框外的部分不导出。水印只说明用途，不提供防复制或防转发保证。
              </li>
              <li>
                <strong>检查并下载。</strong>预览的是新 PNG。原图
                EXIF、文本及其他非必要元数据不会复制到输出；图内文字和图案仍需你自己判断。
              </li>
            </ol>
            <div className="help-tip">
              <ShieldCheck size={21} />
              <p>
                图片不上传、不保存在浏览器数据库，也不调用
                AI。托管方仍会收到普通网页访问请求。本页首次显示“离线已就绪”后，可断网重新打开。
              </p>
            </div>
            <p>
              刷新、关闭或更换图片会丢失本页编辑记录。保留原图，并只分享最终导出的文件。导出透明图片会使用白色背景。
            </p>
            <p className="small-note">
              操作：Ctrl/⌘ + Z 撤销，Ctrl/⌘ + Shift + Z 重做；选中区域后 Delete
              删除。手机拖动画布用于框选，请在图片外滚动页面。
            </p>
            <a
              href="https://github.com/FuzzyLogic112/zheji"
              target="_blank"
              rel="noreferrer"
            >
              遮迹 v0.1.0 · 查看源码与反馈 <ArrowUpRight size={14} />
            </a>
          </div>
        </Dialog>
      )}
    </div>
  );
}
