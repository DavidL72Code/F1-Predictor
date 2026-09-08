// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

/* jsdom implements none of the observer APIs the app uses, so constructing one
   in an effect throws and takes the whole render down. ScrollProgress and
   ScrollIntro use ResizeObserver, CarStage uses IntersectionObserver, and
   several components read matchMedia for prefers-reduced-motion.
   These are inert stand-ins: enough to mount, not pretending to observe. */

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

if (!global.ResizeObserver) global.ResizeObserver = NoopObserver
if (!global.IntersectionObserver) global.IntersectionObserver = NoopObserver

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom has no WebGL; CarStage catches the failure and shows its fallback, but
// without this the console fills with getContext noise on every render.
if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = () => null
}
