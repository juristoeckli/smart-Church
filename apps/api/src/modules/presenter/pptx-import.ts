const maxUploadBytes = 64 * 1024 * 1024;
const maxSlides = 200;

type PowerPointSlide = { label: string; html: string };

/** Render PowerPoint Open XML slides with the vendored, MIT-licensed PPTX2HTML renderer. */
export async function readPowerPointSlides(archive: Buffer): Promise<PowerPointSlide[]> {
  if (archive.length < 22 || archive.length > maxUploadBytes) throw new Error("Choose a .pptx file smaller than 64 MiB.");
  const rendererPath = new URL("../../vendor/pptx2html/src/index.js", import.meta.url);
  const { loadPresentation, renderSlides } = await import(rendererPath.href) as {
    loadPresentation: (bytes: Uint8Array) => { slides: Array<{ index?: number; number?: number; name?: string; background?: { fill?: { type?: string; color?: unknown } } | null }>; width: number; height: number };
    renderSlides: (presentation: unknown) => { slides: string[]; css: string };
  };
  const { css: pptxColorCss } = await import(new URL("../../vendor/pptx2html/src/pptx/color.js", import.meta.url).href) as { css: (color: unknown) => string };
  const presentation = loadPresentation(archive);
  if (!presentation.slides.length || presentation.slides.length > maxSlides) throw new Error("The presentation must contain between 1 and 200 slides.");
  const rendered = renderSlides(presentation);
  if (rendered.slides.length !== presentation.slides.length) throw new Error("The presentation could not be rendered completely.");

  return rendered.slides.map((slideHtml, index) => {
    const slide = presentation.slides[index];
    const label = slide.name?.trim() || `Slide ${index + 1}`;
    const slideBackground = slide.background?.fill?.type === "solid" && slide.background.fill.color ? pptxColorCss(slide.background.fill.color) : "#fff";
    const style = `${rendered.css}\nhtml,body{width:100%;height:100%;margin:0;overflow:hidden;background:${slideBackground}}.pptx-frame{display:flex;width:100vw;height:100vh;align-items:center;justify-content:center;overflow:hidden;background:${slideBackground}}.pp-deck{width:${presentation.width}px;height:${presentation.height}px;flex:0 0 auto}.pp-slide{margin:0!important;box-shadow:none!important}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; media-src data:; style-src 'unsafe-inline' data:; script-src 'none'"><style>${style}</style></head><body class="pp-body"><div class="pptx-frame"><div class="pp-deck pp-list" data-width="${presentation.width}" data-height="${presentation.height}">${slideHtml}</div></div></body></html>`;
    return { label, html };
  });
}
