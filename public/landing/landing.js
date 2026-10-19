// VERTEX — página informativa: animaciones de entrada, recorrido de módulos y navegación.
// Se carga en <head> sin defer para marcar la página como «con JS» antes del primer pintado
// (así el contenido animado no parpadea); el resto espera a que el documento esté listo.
document.documentElement.classList.add('js');

const QUIETO = matchMedia('(prefers-reduced-motion: reduce)').matches;
const WA_TEXTO = 'Hola, me interesa una demostración de VERTEX.';

document.addEventListener('DOMContentLoaded', () => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // WhatsApp con mensaje prellenado
  for (const a of $$('[data-wa]')) a.href = `https://wa.me/529932200146?text=${encodeURIComponent(WA_TEXTO)}`;
  const anio = $('#anio');
  if (anio) anio.textContent = String(new Date().getFullYear());

  // Portada: cada línea del título sube desde su máscara
  for (const l of $$('.hero__title .line')) l.innerHTML = `<span>${l.innerHTML}</span>`;
  requestAnimationFrame(() => requestAnimationFrame(() => $('.hero').classList.add('is-listo')));

  // Aparición al desplazarse, escalonada entre hermanos
  const io = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-visto');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
  );
  for (const el of $$('.reveal, .pilar, .piramide, .telefonos, .frase__txt')) {
    const hermanos = [...el.parentElement.children].filter((h) => h.classList.contains('reveal'));
    const i = hermanos.indexOf(el);
    if (i > 0) el.style.setProperty('--d', `${Math.min(i, 5) * 90}ms`);
    io.observe(el);
  }

  // Navegación: sólida al bajar, se esconde mientras bajas y vuelve al subir
  const nav = $('#nav');
  const hero = $('.hero');
  const flota = $('.wa-flota');
  let ultimoY = scrollY;
  let ancla = scrollY;
  let direccion = 0;
  let pendiente = false;
  // Solo toca el DOM cuando el estado cambia (sin recalcular estilos en cada cuadro)
  const poner = (el, cls, on) => {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  };
  const alDesplazar = () => {
    pendiente = false;
    const y = scrollY;
    poner(nav, 'is-solid', y > 24);
    const pasadoHero = y > hero.offsetHeight * 0.6;
    // Solo cambia tras recorrer una distancia clara en un sentido (evita que parpadee
    // con desplazamientos lentos o el rebote del final de la página)
    const sentido = Math.sign(y - ultimoY);
    if (sentido && sentido !== direccion) {
      direccion = sentido;
      ancla = ultimoY;
    }
    if (!pasadoHero) poner(nav, 'is-oculta', false);
    else if (direccion > 0 && y - ancla > 24) poner(nav, 'is-oculta', true);
    else if (direccion < 0 && ancla - y > 24) poner(nav, 'is-oculta', false);
    poner(flota, 'is-on', pasadoHero);
    ultimoY = y;
    if (!QUIETO) {
      for (const el of $$('[data-parallax]')) {
        const k = Number(el.dataset.parallax);
        el.style.transform = `translate3d(0, ${Math.round(y * k)}px, 0)`;
      }
    }
  };
  addEventListener('scroll', () => {
    if (!pendiente) {
      pendiente = true;
      requestAnimationFrame(alDesplazar);
    }
  }, { passive: true });
  alDesplazar();

  // Enlace activo del menú según la sección visible
  const enlaces = new Map($$('.nav__links a').map((a) => [a.getAttribute('href').slice(1), a]));
  const ioSec = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        for (const a of enlaces.values()) a.classList.remove('is-on');
        enlaces.get(e.target.id)?.classList.add('is-on');
      }
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  for (const id of enlaces.keys()) {
    const s = document.getElementById(id);
    if (s) ioSec.observe(s);
  }

  // Recorrido de módulos: el paso al centro de la pantalla cambia la captura de la derecha
  const pasos = $$('.paso');
  const imgs = new Map($$('.tour__stack img').map((i) => [i.dataset.for, i]));
  const barra = $('#tourBarra');
  const activar = (paso) => {
    for (const p of pasos) p.classList.toggle('is-on', p === paso);
    for (const [k, img] of imgs) img.classList.toggle('is-on', k === paso.dataset.img);
    if (barra) barra.style.width = `${((pasos.indexOf(paso) + 1) / pasos.length) * 100}%`;
  };
  const ioPaso = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) if (e.isIntersecting) activar(e.target);
    },
    { rootMargin: '-48% 0px -48% 0px' }
  );
  for (const p of pasos) ioPaso.observe(p);
  if (pasos[0]) activar(pasos[0]);
});
