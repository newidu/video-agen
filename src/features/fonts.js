/* Font registration and font editing. Extracted from original/source.html lines 1967-2018. */
/* ============================================================
   FONT TOOL — pick a family / weight / spacing for any text, or
   bring your own .ttf/.otf/.woff. Everything lands on the
   element's EDIT entry, so it survives refresh, save and export.
   ============================================================ */
const FONT_CHOICES = ['sans-serif', 'serif', 'monospace', 'Fredoka', 'Baloo', 'Noto Sinhala'];
const CUSTOM_FONTS = {};                 // name -> dataURL (kept in the saved project)
window.CUSTOM_FONTS = CUSTOM_FONTS;
function fontNames() {
  const extra = Object.keys(CUSTOM_FONTS).filter(n => FONT_CHOICES.indexOf(n) < 0);
  return FONT_CHOICES.concat(extra);
}
async function addFontFile(file, name) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const clean = (name || file.name || 'myfont').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w \-]/g, '').slice(0, 40) || 'myfont';
  await registerFont(clean, dataUrl);
  return clean;
}
async function registerFont(name, dataUrl) {
  try {
    const face = new FontFace(name, `url(${dataUrl})`);
    await face.load();
    document.fonts.add(face);
  } catch (e) { console.warn('font load', name, e); }
  CUSTOM_FONTS[name] = dataUrl;
  refresh(); renderPanel(); renderFontBox();
  return name;
}
function setFontOf(ids, patch) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  let n = 0;
  list.forEach(id => {
    Object.keys(EDIT.items).forEach(k => {
      if (k === id || k.indexOf(id + '#') === 0) { delete EDIT.items[k].family; delete EDIT.items[k].weight; delete EDIT.items[k].ls; delete EDIT.items[k].size; }
    });
    const o = itm(id);
    if (patch.family !== undefined) o.family = String(patch.family);
    if (patch.weight !== undefined) o.weight = +patch.weight;
    if (patch.ls !== undefined) o.ls = +patch.ls;
    if (patch.size !== undefined) o.size = +patch.size;
    n++;
  });
  refresh(); renderItems(); renderPanel();
  return n;
}
function renderFontBox() { /* the picker lives inside renderPanel; nothing global to draw */ }

