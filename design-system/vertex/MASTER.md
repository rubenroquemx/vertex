# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** VERTEX
**Generated:** 2026-10-11 00:11:39
**Category:** Government/Public Service
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 3/10 (Subtle) | Density 8/10 (Dense / Dashboard)

---

## Lineamientos de diseño vigentes (prevalecen sobre lo que se contradiga abajo)

Estilo de referencia: monocromo neutro tipo shadcn/ui ("clinical blueprint on frosted paper"),
aplicado a VERTEX con estas decisiones del cliente:

| Tema | Decisión |
|------|----------|
| Color | **Monocromo**: acción principal en tinta `#171717` con texto `#FAFAFA`; sin color de marca en la interfaz. Único color: rojo `#E7000B` para errores y acciones destructivas |
| Sidebar | Se mantiene **oscuro** `#1C1C1E` con logotipo blanco |
| Fondo | Lienzo gris `#F5F5F5` con **tarjetas blancas** encima |
| Tipografía | Se mantiene **Atkinson Hyperlegible** (legibilidad en campo); pesos 400/700 |
| Datos | Mapas y gráficos conservan la paleta categórica validada de zonas (no es decoración) |

### Tokens

| Token | Valor | Uso |
|-------|-------|-----|
| `--color-background` | `#F5F5F5` | Lienzo |
| `--color-card` | `#FFFFFF` | Tarjetas, diálogos, tablas |
| `--color-surface-alt` | `#FAFAFA` | Encabezados de tabla, áreas anidadas |
| `--color-muted` | `#F5F5F5` | Relleno de inputs y botones secundarios |
| `--color-foreground` | `#0A0A0A` | Texto principal |
| `--color-muted-foreground` | `#737373` | Texto secundario |
| `--color-border` | `#E5E5E5` | Líneas finas |
| `--color-destructive` | `#E7000B` | **Solo** acciones destructivas y errores |
| `--radius-lg` | `24px` | Contenedores (tarjetas, diálogos, tablas) |
| `--radius-pill` | `18px` | Interactivos (botones, inputs, etiquetas, chips) |
| `--radius` | `10px` | Anidados (opciones de listas, menú, mapas en tarjeta) |
| `--radius-sm` | `6px` | Pequeños (muestras de color) |
| `--shadow-card` | `0 0 0 1px rgba(23,23,23,.05), 0 1px 3px rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1)` | Elevación de tarjetas |

### Reglas

- Tarjetas: fondo blanco, radio 24, línea fina `#E5E5E5` **y** sombra sutil; padding 20.
- Botones píldora (18): principal en tinta `#171717`; secundario relleno tonal `#F5F5F5`; contorno con línea fina; destructivo rojo.
- Selecciones (chips, opciones, métodos): relleno `#F5F5F5` con contorno de 1 px en tinta; opción activa del sidebar oscuro invertida (papel sobre tinta).
- Estados (en línea, avisos, etiquetas de éxito): neutros; el rojo solo en error/destructivo.
- Inputs píldora con relleno `#F5F5F5` sin borde en reposo. Si el input va directo sobre el lienzo gris, se pinta blanco con línea fina.
- Foco visible siempre (excepción de accesibilidad a los lineamientos): línea `#D4D4D4` + anillo de tinta al 12 %.
- Texto base 14 px; títulos con interletrado cerrado (-0.025em); etiquetas en mayúsculas 12 px a 0.05em.
- Sin degradados ni sombras de color. El rojo nunca decora.
- La implementación vive en las capas finales de `public/css/app.css` ("LINEAMIENTOS DE DISEÑO" y "MONOCROMO").

---

## Global Rules

### Marca (logotipos)

Fuente original: `../RECURSOS/`. Copias en `public/brand/`.

| Archivo | Uso |
|---------|-----|
| `logo-oscuro.svg` (blanco) | Sobre fondos oscuros: sidebar, splash. Altura 28px en sidebar. |
| `logo-claro.svg` (negro) | Sobre fondos claros: login, documentos, reportes impresos. |
| `icono.svg` | Favicon, íconos PWA (`npm run icons`), marca compacta en topbar móvil. |

- El logotipo es **monocromo**; no recolorear con el guinda. El guinda #9D2449 es el color de acento de la interfaz (estado activo, botones primarios, indicadores).
- Área de respeto mínima: la altura de la "V" del isotipo alrededor del logotipo.
- No deformar, rotar ni aplicar sombras/efectos al logotipo.

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary (guinda) | `#9D2449` | `--color-primary` |
| Primary Hover | `#831D3C` | `--color-primary-hover` |
| Primary Soft | `#F9EBEF` | `--color-primary-soft` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Sidebar | `#1C1C1E` | `--color-sidebar` |
| Sidebar Hover | `#2C2C2F` | `--color-sidebar-hover` |
| Sidebar Border | `#2E2E32` | `--color-sidebar-border` |
| Sidebar Text | `#E4E4E7` | `--color-sidebar-fg` |
| Sidebar Muted | `#A1A1AA` | `--color-sidebar-muted` |
| Background (workspace) | `#FFFFFF` | `--color-background` |
| Foreground | `#18181B` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Muted | `#F4F4F5` | `--color-muted` |
| Muted Foreground | `#52525B` | `--color-muted-foreground` |
| Border | `#E4E4E7` | `--color-border` |
| Success | `#15803D` | `--color-success` |
| Destructive | `#DC2626` | `--color-destructive` |
| Ring | `#9D2449` | `--color-ring` |

**Color Notes:** Paleta definida por el cliente: sidebar gris casi negro, espacio de trabajo blanco, primario guinda #9D2449 (contraste 7.5:1 sobre blanco, AAA). Neutros sin tinte azul (zinc) para armonizar con el guinda. Solo modo claro.

### Typography

- **Heading Font:** Atkinson Hyperlegible
- **Body Font:** Atkinson Hyperlegible
- **Mood:** accessible, readable, inclusive, WCAG, dyslexia-friendly, clear
- **Google Fonts:** [Atkinson Hyperlegible + Atkinson Hyperlegible](https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap');
```

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #9D2449;
  color: #FFFFFF;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #9D2449;
  border: 2px solid #9D2449;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E4E4E7;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #9D2449;
  outline: none;
  box-shadow: 0 0 0 3px #9D244933;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** App shell — sidebar fijo + espacio de trabajo (el patrón "Minimal Single Column" generado aplica solo a páginas públicas)

- **Conversion Strategy:** Single CTA focus. Large typography. Lots of whitespace. No nav clutter. Mobile-first.
- **CTA Placement:** Center, large CTA button
- **Section Order:** Hero headline > Short description > Benefit bullets (3 max) > CTA > Footer

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Ornate design
- ❌ Low contrast
- ❌ Motion effects
- ❌ AI purple/pink gradients

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
