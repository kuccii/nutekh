# Nutekh — image replacement spec

This file tells you **what each image is for** and gives **ready-to-paste prompts**. Copy the text inside each **fenced block** (triple backticks) straight into your image model; set aspect ratio in the tool (for example 16:9 for heroes, 1:1 for avatars).

---

## How each prompt is built

Every prompt below is written so an image generator knows:

| Piece | Meaning |
|--------|--------|
| **Role** | What the visitor should feel (trust, energy, clarity). |
| **Composition** | Where the subject sits, where **empty / dark** space is for text overlays. |
| **Subject** | Exactly what to show (people, objects, no fake logos). |
| **Light & color** | Time of day, palette, contrast. |
| **Style** | Photo vs illustration, lens feel, grain. |
| **Avoid** | Things that break layouts or look wrong on a tech site. |

---

## Global strings (paste with every **photo** prompt)

**Prefix (optional but recommended):**

```
Photorealistic editorial business photography, East Africa context when people appear (natural skin tones, contemporary Dar es Salaam or Nairobi style offices or local SMB settings, not Western glass-tower clichés). Clean, believable, high resolution. No text, no logos, no watermarks in frame.
```

**Suffix (negative / quality):**

```
Avoid: distorted hands, extra fingers, unreadable tiny UI text, glossy plastic skin, oversaturated HDR, cluttered frames, celebrity faces, national flags, winter snow cities, stock-photo handshake tropes.
```

---

## 1. Unsplash replacements (slots A–L)

These URLs appear across **`index.html`**, **`about.html`**, **`services.html`**, **`team.html`**, **`pricing.html`**, **`contact.html`**, **`projects.html`** (case studies index), **`blog.html`**. Generate **one image per slot**, export WebP/JPEG, then replace URLs in HTML with `assets/imgs/...`.

**Unsplash ID → slot**

- `photo-1552664730-d307ca884978` → **A**
- `photo-1522071820081-009f0129c71c` → **B**
- `photo-1460925895917-afdab827c52f` → **C**
- `photo-1521737604893-d14cc237f11d` → **D**
- `photo-1556761175-5973dc0f32e7` → **E**
- `photo-1551288049-bebda4e38f71` → **F**
- `photo-1551434678-e076c223a692` → **G**
- `photo-1507003211169-0a1dd7228f2d` → **H**
- `photo-1494790108377-be9c29b29330` → **I**
- `photo-1500648767791-00dcc994a43e` → **J**
- `photo-1472099645785-5658abf4ff4e` → **K**
- `photo-1438761681033-6461ffad8d80` → **L**

---

### Slot A — Team energy (wide hero / large slides)

- **Use:** Main hero panels, big portfolio strips; needs **space for headline on one side** or **dark overlay zone**.
- **Aspect:** 16:9 or 3:2, **landscape**.

```
Wide shot inside a bright modern office in East Africa: three or four professionals gathered around one laptop on a table, mid-conversation, genuine expressions. Place the group slightly off-center; leave one third of the frame as softer background (wall or window) so a designer can add dark gradient and text. Natural daylight from the side, shallow depth of field (background gently blurred). Documentary feel, not posed advertising. No visible screen text, no brand logos.
```

---

### Slot B — Tech & trust (hero / case study)

- **Use:** Second hero option, “technology + business” mood.
- **Aspect:** 16:9, **landscape**.

```
Close-up shot: hands on a laptop keyboard, screen visible but charts and numbers blurred so nothing is readable. Cool-neutral color grade (slight teal/blue in shadows), trustworthy calm mood. Desk is tidy: notebook edge, phone face-down. Leave upper area slightly darker for overlay text. Office window bokeh optional. Sharp focus on hands and keyboard; no face required.
```

---

### Slot C — Growth & analytics (“Build presence”, services cards)

- **Use:** Service tiles about visibility, growth, dashboards.
- **Aspect:** ~4:3 or 16:9 **landscape**.

```
Medium shot: a business owner or manager at a clean desk looking at a laptop showing a simple line chart (blurred, no readable labels). A smartphone lies beside the laptop. Expression is thoughtful and optimistic. Soft daylight, warm-neutral palette. Background is a plain wall or soft office blur—uncluttered. Space in the top or left third for UI overlay if needed.
```

---

### Slot D — Workshop / stand-up (thumbnails, secondary)

- **Use:** Smaller hero thumbs, “team working” vibe.
- **Aspect:** 4:3 or 1:1.

```
Small team stand-up near a whiteboard with a few sticky notes (no readable writing). Mix of ages, casual-smart clothes, East African office. Warm indoor light, energetic but not chaotic. Camera at eye level, slightly wide lens. Keep bottom third slightly calmer for caption area.
```

---

### Slot E — Presentation / transformation

- **Use:** Sections about change, training, digital adoption.
- **Aspect:** 16:9 **landscape**.

```
Hybrid meeting scene: one person stands near a large monitor while two colleagues sit with laptops. The monitor shows a generic slide (blurred). Room feels like a real company training space, not a stadium. Even lighting, natural skin tones. Composition balanced left-to-right with open area on one side for text overlay.
```

---

### Slot F — Automation & dashboards

- **Use:** “Automate”, KPI, operations imagery.
- **Aspect:** 16:9 **landscape**.

```
Desk-level view of multiple devices suggesting automation: laptop with abstract dashboard (blurred shapes only), optional second screen, maybe a phone showing notification icons without readable text. Cool blue-gray palette, crisp and modern. High clarity, low clutter. Reserve a band of darker negative space along top or bottom for dark overlay.
```

---

### Slot G — Integration & systems

- **Use:** “Connect systems”, APIs, integration story.
- **Aspect:** 16:9 **landscape**.

```
Abstract tech illustration OR soft 3D: floating generic app icons (squares, circles) connected by thin curved lines, like a network. Very subtle silhouette of the African continent or East Africa as a faint map watermark—optional and understated. Deep navy to teal gradient background, minimal, no text. Style: clean vector-like or soft 3D, not noisy sci-fi wires everywhere.
```

---

### Slots H, I, J, K, L — Headshots (avatars, team, testimonials)

**Common rules for all:** Square output **1024×1024** (or 800×800), **centered face**, **neutral gray or warm off-white background**, **softbox-style light** from front-left, **business casual**, **direct or slight 3/4 gaze**, **no ID badges, no text**.

**H — Man A (primary male avatar)**

```
Professional corporate headshot, East African man, late 20s to 30s, short natural hair, warm skin tone, subtle smile, navy or gray shirt, neutral studio background, soft light, sharp eyes, photorealistic, square crop chest-up.
```

**I — Woman A (primary female avatar)**

```
Professional corporate headshot, East African woman, late 20s to 30s, natural hair styled simply, small earrings optional, warm smile, blouse or blazer, neutral studio background, soft light, photorealistic, square crop chest-up.
```

**J — Man B (different person from H)**

```
Professional headshot, East African man, different face from typical stock models, early 40s, light stubble optional, glasses optional, confident calm expression, earth-tone shirt, same lighting and background style as a corporate portrait series, square crop chest-up.
```

**K — Man C (mature)**

```
Professional headshot, East African man, 50s, short gray-flecked hair, friendly credible expression, blazer, neutral gray background, soft diffused light, square crop chest-up, photorealistic.
```

**L — Woman B (different from I)**

```
Professional headshot, East African woman, 30s–40s, different hairstyle and face from “Woman A”, subtle makeup, approachable expression, blazer, neutral background, soft studio light, square crop chest-up.
```

---

## 2. CSS-only images (`assets/css/style.css`)

Paths are relative to CSS: `../imgs/...` = `assets/imgs/...`.

### `team/3.png` (background portrait)

```
Vertical crop portrait, chest-up, professional person in muted clothing, soft side light, darker tones in background so white text can sit on top in a section. Slight vignette. Photorealistic. Aspect tall portrait (~3:4).
```

### `intro/mshap1.png` & `intro/p1.png` (paired abstract blobs)

**mshap1:**

```
Single large abstract organic blob, smooth edges, soft gradient from light gray to white, subtle film grain, transparent or very light gray background, no hard shadows. Intended as floating parallax shape behind content.
```

**p1:**

```
Second abstract shape, complementary to a rounded blob: more angular or elongated curve, same material (soft gradient, light gray), same grain, works as a pair with mshap1 in layered motion.
```

### `map-global.png`

```
Flat vector-style map of Africa and Middle East, simplified country borders very light gray lines on off-white. Subtle highlight fill on Tanzania/Kenya/Uganda/Rwanda region in one brand accent color (teal or blue). No city names, no political labels, no icons. Clean infographic style, 16:9.
```

### `hero/md.png` (texture layer)

```
Subtle noise texture overlay: very soft monochrome grain plus faint diagonal light streak, low contrast, meant to sit behind hero text. No objects, no faces. Square or wide tile that can repeat or stretch.
```

---

## 3. Brand & favicon

| File | What to produce | Clear instruction |
|------|------------------|-------------------|
| `favicon.ico` / `favicon-32x32.png` / `apple-touch-icon.png` / `android-chrome-192x192.png` | One **master** 512×512 PNG first | Design the Nutekh mark (or “N” monogram) on solid color; export each size with safe padding. **Do not use AI for tiny 16×16 clarity**—draw in vector, export. |
| `nutekhlogo.png` | Full wordmark for header | **Prefer your official brand file.** If remaking: horizontal lockup, dark gray or black text, optional small geometric mark, **transparent PNG**, min height ~80px at 2x. |
| `paper-plane.svg` | Icon | Single open path outline of paper plane, 24px grid, 2px stroke, rounded joins, monochrome. |

---

## 4. Small UI SVGs (clear specs)

| File | Clear spec |
|------|------------|
| `star.svg` / `star.png` | Four-point star, 24×24 viewBox, stroke or fill single color, center aligned. |
| `arrow-crv.svg` | Curved arrow, 16px tall, stroke 1.5px, pointing down-right for FAQ expand. |
| `arrow-top-right.svg` | Straight arrow with 45° bend, minimal, for “open link”. |
| `circle-text.svg` | Designer task: circular path with repeated “NUTEKH • DIGITAL GROWTH •” text, not AI raster. |
| `logo-icon.svg` | Small square mark matching main logo. |
| `global.svg` | Line-art globe, circle + meridians, 2px stroke, 24px. |
| `process.svg` | Horizontal 4 steps with icons: magnifying glass → hammer/wrench → rocket → chart; large labels: Discover, Build, Launch, Improve; flat vector, generous spacing. |

---

## 5. Replace third-party marks

| File | Clear replacement |
|------|-------------------|
| `logo-clutch.svg` | New SVG: rounded rectangle badge, text “4.9 / 5 client rating”, five small stars, no “Clutch” name. |
| `testim/envato-logo.svg` | Simple “Verified project” checkmark badge or Nutekh monogram only. |
| `trustpilot.svg` | Word “Reviews” in clean sans + star row, or remove logo and use stars only in HTML/CSS. |

---

## 6. Hero folder (`assets/imgs/hero/`)

### `m.jpg` — Marketing Engine hero panel

```
Large rectangular hero background behind big typography: split composition—left two-thirds is soft abstract gradient (deep charcoal to teal); right third shows a moody still life on a desk (closed laptop, smartphone, notebook, coffee cup) with one small plant. Cinematic lighting, shallow depth of field, **no people**, **no readable text**. Aspect ~16:9. Dark enough overall that white headline text reads clearly on left.
```

### `4.jpg` — Digital agency full-bleed hero

```
Wide interior of a creative agency: designers at desks, plants, large windows, warm afternoon light. Energetic but organized. **Leave upper third slightly darker** for overlay. Photorealistic 16:9, no lens flare overload.
```

### `abob.png` & `rocket.png` — Small stickers (~128px)

**abob:**

```
Tiny flat illustration sticker: speech bubble with abstract shapes inside, playful, brand accent colors, transparent PNG, no text.
```

**rocket:**

```
Tiny flat rocket icon, simple geometric shapes, same accent color as site primary, transparent PNG, 128×128.
```

### `w1.png`–`w4.png` — Four story panels (digital agency)

**w1 — Brand**

```
Hands arranging printed color swatches and logo sketches on a desk, top-down or 45° angle, soft daylight, shallow DOF, no readable words on paper.
```

**w2 — Development**

```
Developer desk: external monitor with blurred code editor, mechanical keyboard, coffee mug, dark cozy lighting, cool tones.
```

**w3 — Marketing**

```
Creative workspace: tablet with blurred social/grid layout, marker pens, sticky notes with no readable text, bright friendly light.
```

**w4 — Analytics**

```
Hands pointing at printed chart and laptop with blurred dashboard, warm neutral palette, professional mood.
```

### `w6.png`, `w7.png` — Match Marketing Engine “works” series (see section 7).

### `hero/2/*.webp` — Design studio collage (generate 6–8 distinct tiles)

Use one **style lock** for all:

```
Style lock: desaturated editorial photography, soft shadows, cream and charcoal palette, subtle grain. Subjects: design desk, fabric swatches, drafting tools, tablet with blurred UI, hands sketching, typography specimens out of focus. Each image different subject but same color grade. Square or 4:5 crops.
```

### `f3.png` — Freelancer hero float

```
Portrait-oriented abstract composition: warm gradient (peach to cream) with floating soft shapes suggesting creativity (brush stroke blur, not literal brush). No people. 3:4 aspect, calm and friendly.
```

### `hero/s-icon1.svg`, `s-icon2.svg`

- **s-icon1:** Line icon: chart with upward trend in circle, 48px, stroke 2px.  
- **s-icon2:** Line icon: megaphone or broadcast waves, 48px, stroke 2px.

### `hero/awards/1.svg`–`3.svg`

```
Three small circular line badges: (1) trending-up arrow, (2) two people silhouette, (3) clock with check—minimal line art, monochrome, 64px circles.
```

---

## 7. Portfolio `works/`

### Package sliders & parallax — `works/2/*`

**Goal:** Full-bleed slides with **dark overlay** in template—each image should have **strong subject + readable contrast band** for centered white title.

| File | Prompt |
|------|--------|
| `1.webp` | `Interior wide shot: modern open-plan office in African city, people working at desks in background softly blurred, foreground empty floor space, large windows, horizontal composition 16:9, natural light.` |
| `3.jpg` | `Logistics: warehouse or loading bay, worker in safety vest at distance, golden hour light, wide 16:9, cinematic, not chaotic.` |
| `4.webp` | `Team at whiteboard seen from behind, whiteboard content blurred, office setting, 16:9, space for dark overlay at bottom third.` |
| `6.webp` | `Healthcare: bright clinic reception or waiting chairs, clean and calm, no logos, soft daylight, 16:9.` |
| `7.webp` | `Education: classroom or training room with laptops, students from behind, warm light, 16:9.` |
| `9.webp` | `Retail: shop counter with POS terminal blurred, friendly interior, 16:9 horizontal.` |
| `11.webp` | `Field work: person with tablet outdoors, NGO or community context, respectful documentary style, 16:9, sky or trees in background.` |
| `12.webp` | `Manufacturing: machinery or assembly line shallow DOF, safety and professionalism, cool industrial light, 16:9.` |
| `13.webp` | `Professional services: meeting in glass-walled room, silhouettes and blurred faces, corporate calm, 16:9.` |
| `1.png` | `Same mood as 1.webp; alternate crop slightly tighter for carousel thumbnails.` |

### Design studio grid — `works/3/*`

```
Unified series: creative agency portfolio stills—mood boards on wall, iMac with blurred UI, printed poster flat lay, color pencils, hands holding phone. Muted sage and charcoal palette, soft shadows, 16:9 or 4:5 per asset, photorealistic.
```

### Gallery set — `works/4/1.webp`–`8.webp`

```
Eight varied shots in one campaign: (1) architectural interior, (2) product on pedestal, (3) lifestyle hand holding phone, (4) team candid, (5) nature texture detail, (6) workspace top-down, (7) event crowd blurred, (8) close-up fabric/material. Consistent film color grade (slightly warm shadows), no text in frame.
```

### Marketing Engine cards — `works/w1.png`–`w7.png`

| File | Prompt |
|------|--------|
| `w1.png` | `Desk with laptop showing blurred map pin list, small plant, notebook, top-down 45°, soft daylight, SEO/local business vibe.` |
| `w2.png` | `Whiteboard with simple funnel sketch (blurred), two people gesturing, office, 16:9.` |
| `w3.png` | `Laptop with blurred landing page + smartphone with message app icons blurred, same desk, conversion-focused mood.` |
| `w4.png` | `Creative desk with multiple small ad mockups as floating blurred rectangles on screen, coffee, 16:9.` |
| `w6.png` | `Hands highlighting printed weekly report with simple bar graphics blurred, pen, laptop edge visible, 16:9.` |
| `w7.png` | `Street-level storefront with person holding phone showing blurred map app, urban East Africa street, daytime, 16:9.` |
| `w11.jpg` | `Tall portfolio crop: dramatic vertical photo of office atrium or staircase, leading lines, moody light, 3:4 or 9:16 source cropped to tall rectangle.` |

### `w8.mp4` (video, not a still)

```
10–15 second loop: screen recording style of ad campaign interface (blurred) cutting to WhatsApp-style chat scroll (blurred names), then back; cursor moves slowly; no readable personal data; 1920×1080, subtle motion blur.
```

---

## 8. Services & skills

### `serv/s1.jpg`–`s4.jpg` (hover reveals — abstract, low detail)

| File | Prompt |
|------|--------|
| `s1.jpg` | `Abstract blue gradient with faint map grid and location pin shapes, soft blur, 16:9, no text.` |
| `s2.jpg` | `Abstract ad network: floating rectangles suggesting ad units, purple and blue bokeh, 16:9.` |
| `s3.jpg` | `Abstract chat automation: soft green and white bubbles as geometric shapes, blurred, 16:9.` |
| `s4.jpg` | `Abstract A/B test: split background two tones with cursor icon shape, minimal, 16:9.` |

### `serv/bs1.png`–`bs3.png` — Isometric cards

```
Isometric 3D illustration set, three matching cards: (1) browser window with shop icon, (2) gear and automation flow, (3) database cylinders connected by pipes. Soft shadows, white + teal + charcoal, same camera angle for all three, transparent or light gray background, 1:1 each.
```

### `serv/sr1.png`–`sr4.png` — Flat illustrations

```
Flat vector illustrations, consistent stroke: (1) pen tool / bezier, (2) code brackets, (3) megaphone, (4) camera. Pastel fills, 512×512 each.
```

### `serv/1.svg`–`7.svg`

```
Icon set, 24px grid, 2px stroke: globe, stacked layers, link chain, bar chart, shield, users, settings—monoline family, single color.
```

### `serv/1.jpg`–`4.jpg` (personal carousel)

```
Four lifestyle photos: freelancer at café with laptop; person on phone walking; home desk with plant; handshake-free meeting on sofa—all warm natural light, East African context, 16:9, photorealistic.
```

### `skills/s1.png`–`s5.png`

```
Five round “pebble” icons with embossed symbols: pen, code brackets, magnifying glass, palette, headset—soft 3D, isometric pastel style, 128×128 each, consistent lighting from top-left.
```

---

## 9. Team, testimonials, blog

### `team/1.png`–`5.png`

```
Five separate studio portraits, same background (#E8E8E8) and lighting setup: chest-up, business attire variety, different individuals, East African professionals, neutral expressions with slight smile, high resolution, square crops.
```

### `testim/1.jpeg`–`4.jpeg`

```
Match slots H–L headshot prompts or reuse those exports cropped to 800×800 soft-edged circles will work in layout.
```

### `blog/b1.png`–`b4.png`

| File | Prompt |
|------|--------|
| `b1.png` | `Overhead: notebook, pen, coffee, glasses, wooden desk, morning light, no text on pages.` |
| `b2.png` | `Laptop with blurred analytics, plant, minimal desk, cool tone.` |
| `b3.png` | `Leadership theme: single chair in modern office, shallow DOF, inspirational but not cheesy.` |
| `b4.png` | `Productivity: timer, headphones, keyboard detail, warm light.` |

### `blog/1.webp` (article hero)

```
Wide 21:9 cinematic: desk with laptop closed, steaming coffee, rain on window blurred, cozy blog header mood, shallow DOF, no text.
```

### `blog/2.webp`, `5.webp`

```
Supporting article photos: (2) team whiteboard session blurred; (5) hands typing on laptop with notebook—both 16:9, natural light.
```

### `blog/avatar.jpg`

```
Small square author avatar: professional person, same style as team shots, 256×256 export.
```

### `avatar2.jpeg`, `avatar3.jpeg`

```
Two different casual commenter portraits, neutral clothes, plain background, friendly, 400×400, photorealistic.
```

---

## 10. Awards, intros, shapes

### `awards/award-1.jpg`–`award-6.jpg` (including `award-5.jpeg`)

```
Six distinct macro textures: (1) certificate paper and gold seal blur, (2) trophy silhouette on shelf bokeh, (3) conference stage lights abstract, (4) medal ribbon close-up, (5) glass award prism reflections, (6) dark wood plaque with blurred engraving. No readable words. Each 16:9 horizontal, elegant, not glitter explosion.
```

### `intro/01.png`, `01.webp`

```
Abstract fluid paint shapes, soft pink and gray, high resolution, minimal, for section transitions.
```

### `intro/02.png`, `02.webp`

```
Soft photograph: empty modern chair and side table near window, very shallow DOF, calm editorial, horizontal.
```

### `intro/03.png`

```
Bold abstract background: large curved color blocks (teal and charcoal), subtle grain, 16:9, for creative agency statement section.
```

### `intro/h3.jpg`, `h7.png`

```
Architectural detail: concrete and glass corner, geometric shadows, desaturated, calm, wide crop—works behind FAQ text.
```

### `intro/f2.png`

```
Warm peach-to-cream vertical gradient with subtle noise, soft vignette, for freelancer CTA strip.
```

### `reval/*.webp` + `4.png`

```
Gallery of 16 varied abstract and process images: paint strokes, paper tears, macro fabric, blurred office, hands cutting paper—unified 35mm film grain overlay, desaturated with one accent color, no text.
```

### `pattern-bg.webp`

```
Seamless tile: very light gray noise texture, 512×512, almost invisible repeat for subtle background.
```

### `mshap1.png`, `mshap2.webp`, `mshap3.png`, `mshap4.png`

```
Four abstract blobs: (1) large round, (2) elongated wave, (3) small disk, (4) angular shard—all soft gradient fills, light gray to white, for parallax layers, transparent PNG where template expects it.
```

### `shape1.png`

```
Small geometric accent: single tilted rectangle with soft gradient, ~200px wide, for numeric section decoration.
```

---

## 11. Clients `clients/1.svg`–`4.svg`

```
Four fake company wordmarks as simple geometric monograms (A, N, M, K style shapes), grayscale, stroke-based, 120×40 each, **not resembling real brands**.
```

---

## 12. Coverage checklist

- [ ] Generate slots **A–L** and replace Unsplash URLs.  
- [ ] Generate **`works/2`** set for package + portfolio pages.  
- [ ] **`marketing-engine.html`**: `m.jpg`, `w1–w7`, `s1–s4`, `w8.mp4`, headshots, team.  
- [ ] **`index.html`**: hero images + `mshap1.png` (see shapes).  
- [ ] **CSS**: `map-global`, `hero/md`, intro shapes.  
- [ ] **Favicons** from vector master.  
- [ ] **Clutch / Envato / Trustpilot** SVGs replaced.

---

## 13. Implementation order (addresses the “template vs shipped” gap)

The prompts do not change the site until you **export files** and **update references**. Use this order so the smallest work touches the most pages first.

| Step | What to do | Why it matters |
|------|------------|----------------|
| **1** | Generate **slots A–L** (section 1) → save under e.g. `assets/imgs/nutekh/slots/` | One batch removes **remote Unsplash** dependence on the main funnel pages. |
| **2** | Replace `https://images.unsplash.com/...` in HTML with local paths (or run a script from `nutekh-image-manifest.template.json`) | Faster loads, consistent branding, no hotlink breakage. |
| **3** | Generate **`works/2/*`** slide set → overwrite `assets/imgs/works/2/` (same filenames) | **Package** pages (`package-*.html`) and **portfolio** demos update together. |
| **4** | **`marketing-engine.html`** + **`index.html`**: hero, panels, testimonials | Highest visible Nutekh story. |
| **5** | Swap **third-party** SVGs (Clutch, Envato, Trustpilot) per section 5 | Stops the site from reading like a theme demo. |
| **6** | **`assets/css/style.css`** backgrounds (`map-global`, `team/3`, `hero/md`, intro blobs) | Fixes images that **HTML grep alone** will miss. |
| **7** | Remaining demo homepages (`home-*.html`) and portfolio templates | Only after the funnel looks finished. |
| **8** | Favicons / master logo from vector | Crisp at 16px; no AI raster for tiny icons. |

**Rule of thumb:** If a path appears in **10+ files**, replace the **file on disk** (same name) instead of editing every HTML line—unless you are introducing a new folder structure.

---

## 14. Suggested file naming (optional `nutekh/` subfolder)

If you want new assets alongside the theme without deleting originals until QA:

- `assets/imgs/nutekh/slot-a.webp` … `slot-l.webp` (or `.jpg`) for Unsplash slots.  
- After QA, either **rename to match old paths** or **bulk-replace** paths in HTML/CSS.

For **in-place** replacement (simplest deploy): export with **exact existing filenames** (e.g. `works/2/1.webp`) so no HTML changes are required.

---

## 15. Finding references (audit before/after)

From the repo root (PowerShell):

```powershell
# All local image paths (HTML + Nunjucks)
Get-ChildItem -Path . -Recurse -File -Include *.html,*.njk | Select-String -Pattern 'assets/imgs/'

# All Unsplash URLs
Get-ChildItem -Path . -Recurse -File -Include *.html | Select-String -Pattern 'images\.unsplash\.com'

# CSS background images only
Select-String -Path 'assets\css\style.css' -Pattern 'url\('
```

**Funnel pages to eyeball first:** `index.html`, `services.html`, `about.html`, `contact.html`, `marketing-engine.html`, `package-launch.html`, `package-grow.html`, `package-scale.html`, `pricing.html`.

---

## 16. Machine-readable manifest (scripted rewrites)

For find-replace or a small Node script, maintain **`nutekh-image-manifest.template.json`** in the project root. Copy it to `nutekh-image-manifest.json` (git-ignored if it contains secrets—here it is only paths), fill in `to` values as you export files, then replace URLs/paths in bulk.

The template documents **`from` → `to`** pairs so you are not relying on memory when the analysis says “replace Unsplash with local.”

---

*To extend prompt text: search for `assets/imgs/` and add subsections with the same structure as above.*
 