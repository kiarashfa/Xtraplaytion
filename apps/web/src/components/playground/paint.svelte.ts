// Limits a canvas $effect to one draw per animation frame.
//
// Worker frames arrive many times per display frame (one stream per model). Drawing on every
// message made Chrome wait for the GPU inside each message handler (canvas backpressure), so a
// six-model race dropped to ~5 fps. Usage inside an $effect, after the cheap guards:
//
//   if (!paint.ready()) return;   // schedules the draw for the next animation frame
//   ...read state and draw...
//
// When the effect runs outside an animation frame, `ready()` reads only its own tick and
// returns false; the next frame bumps the tick, the effect runs again inside that frame,
// reads (and so tracks) everything it draws, and draws once.
export class FramePaint {
  #tick = $state(0);
  #due = false;
  #id = 0;

  ready(): boolean {
    void this.#tick;
    if (this.#due) {
      this.#due = false;
      return true;
    }
    if (!this.#id) {
      this.#id = requestAnimationFrame(() => {
        this.#id = 0;
        this.#due = true;
        this.#tick++;
      });
    }
    return false;
  }

  dispose() {
    if (this.#id) cancelAnimationFrame(this.#id);
    this.#id = 0;
  }
}
