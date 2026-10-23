'use client';

import { useEffect } from 'react';
import Swiper, { Autoplay, Navigation, Pagination } from 'swiper';

/**
 * Vanilla re-implementation of the bits of Elementor / Elementor Pro / Blocksy front-end JS
 * the old site relied on: sticky header, nav menu (dropdown + mobile toggle), entrance
 * animations, image carousel, gallery grid, lightbox, lazy backgrounds, posts image fit.
 */

const BP_MOBILE = 767;
const BP_TABLET = 1024;

function settingsOf(el: Element): Record<string, any> {
  try {
    return JSON.parse(el.getAttribute('data-settings') || '{}');
  } catch {
    return {};
  }
}

function device() {
  const w = window.innerWidth;
  return w <= BP_MOBILE ? 'mobile' : w <= BP_TABLET ? 'tablet' : 'desktop';
}

function responsive(s: Record<string, any>, key: string) {
  const d = device();
  const pick = (k: string) => (s[k] === undefined || s[k] === '' || (s[k] && typeof s[k] === 'object' && s[k].size === '') ? undefined : s[k]);
  if (d === 'mobile') return pick(`${key}_mobile`) ?? pick(`${key}_tablet`) ?? pick(key);
  if (d === 'tablet') return pick(`${key}_tablet`) ?? pick(key);
  return pick(key);
}

function initSticky(root: ParentNode) {
  const section = root.querySelector<HTMLElement>('.elementor-location-header [data-settings*="sticky"]');
  if (!section) return;
  const header = section.closest<HTMLElement>('.elementor-location-header');
  if (!header) return;
  header.classList.add('fd-sticky-header');
  section.classList.add('elementor-sticky', 'elementor-sticky--active', 'elementor-section--handles-inside');
  const onScroll = () => section.classList.toggle('elementor-sticky--effects', window.scrollY > 0);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

function initNavMenus(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.elementor-widget-nav-menu').forEach((widget) => {
    const toggle = widget.querySelector<HTMLElement>('.elementor-menu-toggle');
    const dropdown = widget.querySelector<HTMLElement>('nav.elementor-nav-menu--dropdown');
    const stretch = () => {
      if (!dropdown || !widget.classList.contains('elementor-nav-menu--stretch')) return;
      const w = document.documentElement.clientWidth;
      const left = widget.getBoundingClientRect().left;
      dropdown.style.width = `${w}px`;
      dropdown.style.left = `${-left}px`;
    };
    const close = () => {
      toggle?.classList.remove('elementor-active');
      toggle?.setAttribute('aria-expanded', 'false');
      dropdown?.setAttribute('aria-hidden', 'true');
    };
    toggle?.addEventListener('click', () => {
      const open = !toggle.classList.contains('elementor-active');
      toggle.classList.toggle('elementor-active', open);
      toggle.setAttribute('aria-expanded', String(open));
      dropdown?.setAttribute('aria-hidden', String(!open));
      dropdown?.querySelectorAll('a').forEach((a) => (open ? a.removeAttribute('tabindex') : a.setAttribute('tabindex', '-1')));
      stretch();
    });
    toggle?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        toggle.click();
      }
    });
    window.addEventListener('resize', () => {
      stretch();
      if (window.innerWidth > BP_TABLET) close();
    });
    stretch();
    // collapsible sub-menus inside the mobile dropdown (SmartMenus "collapsible" behaviour)
    dropdown?.querySelectorAll<HTMLAnchorElement>('a.has-submenu').forEach((a) => {
      a.addEventListener('click', (e) => {
        const sub = a.parentElement?.querySelector<HTMLElement>(':scope > ul.sub-menu');
        if (!sub) return;
        const open = sub.style.display === 'block';
        const onArrow = (e.target as HTMLElement).closest('.sub-arrow');
        if (!open || onArrow) {
          e.preventDefault();
          sub.style.display = open ? '' : 'block';
          a.classList.toggle('highlighted', !open);
          a.setAttribute('aria-expanded', String(!open));
        }
      });
    });
    // desktop: keyboard / touch support for the hover dropdown
    widget.querySelectorAll<HTMLAnchorElement>('nav.elementor-nav-menu--main a.has-submenu').forEach((a) => {
      a.setAttribute('aria-haspopup', 'true');
      a.setAttribute('aria-expanded', 'false');
      const li = a.parentElement!;
      li.addEventListener('mouseenter', () => {
        a.classList.add('highlighted');
        a.setAttribute('aria-expanded', 'true');
      });
      li.addEventListener('mouseleave', () => {
        a.classList.remove('highlighted');
        a.setAttribute('aria-expanded', 'false');
      });
    });
  });
}

function initAnimations(root: ParentNode) {
  const els = Array.from(root.querySelectorAll<HTMLElement>('.elementor-invisible'));
  if (!els.length) return;
  const show = (el: HTMLElement) => {
    const s = settingsOf(el);
    const anim = responsive(s, '_animation') || responsive(s, 'animation');
    const delay = Number(s._animation_delay || s.animation_delay || 0);
    const run = () => {
      el.classList.remove('elementor-invisible');
      if (anim && anim !== 'none') el.classList.add('animated', anim);
    };
    delay ? setTimeout(run, delay) : run();
  };
  if (!('IntersectionObserver' in window)) return els.forEach(show);
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          io.unobserve(en.target);
          show(en.target as HTMLElement);
        }
      }),
    { rootMargin: '0px 0px -10% 0px' },
  );
  els.forEach((el) => io.observe(el));
}

function initLazyBackgrounds(root: ParentNode) {
  const els = Array.from(root.querySelectorAll<HTMLElement>('.e-con.e-parent:not(.e-lazyloaded)'));
  if (!els.length) return;
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => en.isIntersecting && (en.target.classList.add('e-lazyloaded'), io.unobserve(en.target))),
    { rootMargin: '200px 0px 200px 0px' },
  );
  els.forEach((el) => io.observe(el));
}

function initCarousels(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.elementor-widget-image-carousel').forEach((widget) => {
    const s = settingsOf(widget);
    const container = widget.querySelector<HTMLElement>('.elementor-image-carousel-wrapper');
    if (!container) return;
    const slides = container.querySelectorAll('.swiper-slide').length;
    const num = (v: any, d: number) => (v === undefined || v === '' ? d : Number(v));
    const desktopShow = num(s.slides_to_show, 3);
    const tabletShow = num(s.slides_to_show_tablet, Math.min(desktopShow, 2));
    const mobileShow = num(s.slides_to_show_mobile, 1);
    const gap = (k: string) => (s[k] && s[k].size !== '' && s[k].size !== undefined ? Number(s[k].size) : undefined);
    const gD = gap('image_spacing_custom') ?? 20;
    const gT = gap('image_spacing_custom_tablet') ?? gD;
    const gM = gap('image_spacing_custom_mobile') ?? gT;
    const scrollD = num(s.slides_to_scroll, 1);
    const scrollT = num(s.slides_to_scroll_tablet, 1);
    const scrollM = num(s.slides_to_scroll_mobile, 1);
    const nav = s.navigation || 'both';
    const opts: any = {
      modules: [Navigation, Pagination, Autoplay],
      slidesPerView: mobileShow,
      slidesPerGroup: scrollM,
      spaceBetween: gM,
      loop: s.infinite === 'yes' && slides > 1,
      speed: num(s.speed, 500),
      grabCursor: true,
      handleElementorBreakpoints: true,
      breakpoints: {
        [BP_MOBILE + 1]: { slidesPerView: tabletShow, slidesPerGroup: scrollT, spaceBetween: gT },
        [BP_TABLET + 1]: { slidesPerView: desktopShow, slidesPerGroup: scrollD, spaceBetween: gD },
      },
    };
    if (s.autoplay === 'yes') {
      opts.autoplay = { delay: num(s.autoplay_speed, 5000), disableOnInteraction: s.pause_on_interaction === 'yes', pauseOnMouseEnter: s.pause_on_hover === 'yes' };
    }
    if (nav === 'arrows' || nav === 'both') {
      opts.navigation = {
        prevEl: widget.querySelector('.elementor-swiper-button-prev'),
        nextEl: widget.querySelector('.elementor-swiper-button-next'),
      };
    }
    if (nav === 'dots' || nav === 'both') {
      opts.pagination = { el: widget.querySelector('.swiper-pagination'), type: 'bullets', clickable: true };
    }
    // eslint-disable-next-line no-new
    new Swiper(container, opts);
  });
}

function initGalleries(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.elementor-widget-gallery').forEach((widget) => {
    const s = settingsOf(widget);
    const c = widget.querySelector<HTMLElement>('.elementor-gallery__container');
    if (!c) return;
    const layout = s.gallery_layout || 'grid';
    c.classList.add('e-gallery-container', `e-gallery-${layout}`, 'e-gallery--ltr');
    const apply = () => {
      const cols = Number(responsive(s, 'columns') || 4);
      const gapObj = responsive(s, 'gap');
      const gap = gapObj && gapObj.size !== '' ? Number(gapObj.size) : 10;
      const ratio = String(responsive(s, 'aspect_ratio') || '3:2').split(':').map(Number);
      c.style.setProperty('--columns', String(cols));
      c.style.setProperty('--hgap', `${gap}px`);
      c.style.setProperty('--vgap', `${gap}px`);
      c.style.setProperty('--aspect-ratio', `${(ratio[1] / ratio[0]) * 100}%`);
    };
    apply();
    window.addEventListener('resize', apply);
    c.querySelectorAll<HTMLElement>('.e-gallery-image[data-thumbnail]').forEach((img) => {
      img.style.backgroundImage = `url("${img.dataset.thumbnail}")`;
      img.classList.add('e-gallery-image-loaded');
    });
  });
}

function initPostsImageFit(root: ParentNode) {
  // Elementor Pro posts handler: containers whose thumbnails have an item ratio (padding-bottom) get the ratio class
  root.querySelectorAll<HTMLElement>('.elementor-posts-container').forEach((c) => {
    const t = c.querySelector<HTMLElement>('.elementor-post__thumbnail');
    if (t && parseFloat(getComputedStyle(t).paddingBottom) > 0) c.classList.add('elementor-has-item-ratio');
  });
  root.querySelectorAll<HTMLElement>('.elementor-posts-container.elementor-has-item-ratio .elementor-post__thumbnail').forEach((thumb) => {
    const img = thumb.querySelector('img');
    if (!img) return;
    const fit = () => {
      const itemRatio = thumb.clientHeight / Math.max(thumb.clientWidth, 1);
      const imgRatio = img.naturalHeight / Math.max(img.naturalWidth, 1);
      thumb.classList.toggle('elementor-fit-height', itemRatio > imgRatio);
    };
    img.complete ? fit() : img.addEventListener('load', fit, { once: true });
  });
}

const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?.*)?$/i;

function initLightbox(root: ParentNode) {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.elementor a[href]')).filter(
    (a) => IMG_RE.test(a.getAttribute('href') || '') && a.dataset.elementorOpenLightbox !== 'no',
  );
  if (!links.length) return;
  let box: HTMLDivElement | null = null;
  let group: HTMLAnchorElement[] = [];
  let idx = 0;
  const render = () => {
    if (!box) return;
    const a = group[idx];
    const img = box.querySelector('img')!;
    img.src = a.href;
    img.alt = a.dataset.elementorLightboxTitle || '';
    box.querySelector('.fd-lightbox-title')!.textContent = a.dataset.elementorLightboxTitle || '';
    box.querySelector('.fd-lightbox-counter')!.textContent = group.length > 1 ? `${idx + 1} / ${group.length}` : '';
    box.classList.toggle('fd-lightbox--single', group.length < 2);
  };
  const close = () => {
    box?.remove();
    box = null;
    document.removeEventListener('keydown', onKey);
  };
  const step = (d: number) => {
    idx = (idx + d + group.length) % group.length;
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  };
  const open = (a: HTMLAnchorElement) => {
    const slideshow = a.dataset.elementorLightboxSlideshow;
    group = (slideshow ? links.filter((l) => l.dataset.elementorLightboxSlideshow === slideshow) : [a]).filter((l) => IMG_RE.test(l.getAttribute('href') || ''));
    idx = Math.max(0, group.indexOf(a));
    box = document.createElement('div');
    box.className = 'fd-lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML =
      '<button type="button" class="fd-lightbox-close" aria-label="關閉">&times;</button>' +
      '<button type="button" class="fd-lightbox-prev" aria-label="上一張">&#8249;</button>' +
      '<figure><img alt=""><figcaption><span class="fd-lightbox-title"></span><span class="fd-lightbox-counter"></span></figcaption></figure>' +
      '<button type="button" class="fd-lightbox-next" aria-label="下一張">&#8250;</button>';
    box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.fd-lightbox-prev')) return step(-1);
      if (t.closest('.fd-lightbox-next')) return step(1);
      if (t.closest('.fd-lightbox-close') || t === box) close();
    });
    document.body.appendChild(box);
    document.addEventListener('keydown', onKey);
    render();
    (box.querySelector('.fd-lightbox-close') as HTMLButtonElement).focus();
  };
  links.forEach((a) =>
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (!IMG_RE.test(a.getAttribute('href') || '')) return; // href rewritten by a page script -> plain link
      e.preventDefault();
      open(a);
    }),
  );
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/** Runs inline scripts from Elementor HTML widgets (parked by deferScripts) with WP's jQuery + Migrate. */
async function runDeferredScripts(root: ParentNode) {
  const scripts = Array.from(root.querySelectorAll<HTMLScriptElement>('script[type="text/fd-deferred"]'));
  if (!scripts.length) return;
  const w = window as unknown as { jQuery?: any };
  if (scripts.some((s) => /jQuery|\$\(/.test(s.textContent || '')) && !w.jQuery) {
    await loadScript('/wp/wp-includes/js/jquery/jquery.min.js');
    await loadScript('/wp/wp-includes/js/jquery/jquery-migrate.min.js');
  }
  for (const old of scripts) {
    const el = document.createElement('script');
    for (const a of Array.from(old.attributes)) if (a.name !== 'type') el.setAttribute(a.name, a.value);
    if (!old.src) el.textContent = old.textContent;
    old.replaceWith(el);
  }
  // scripts written for $(window).load(...) expect the load event to still be ahead of them
  const fire = () => w.jQuery && w.jQuery(window).trigger('load');
  document.readyState === 'complete' ? fire() : window.addEventListener('load', () => setTimeout(fire, 0), { once: true });
}

export function WpRuntime() {
  useEffect(() => {
    const root = document.getElementById('wp-body');
    if (!root || root.dataset.fdInit) return;
    root.dataset.fdInit = '1';
    document.documentElement.classList.remove('no-js');
    const steps = [initSticky, initNavMenus, initAnimations, initLazyBackgrounds, initCarousels, initGalleries, initPostsImageFit, initLightbox];
    for (const f of steps) {
      try {
        f(root);
      } catch (err) {
        console.error('[wp-runtime]', f.name, err);
      }
    }
    runDeferredScripts(root).catch((err) => console.error('[wp-runtime] scripts', err));
  }, []);
  return null;
}
