"use client";

import { useEffect, useRef } from "react";

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export default function CinemaCursor({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const tailOneRef = useRef<HTMLDivElement | null>(null);
  const tailTwoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      !rootRef.current ||
      !coreRef.current ||
      !haloRef.current ||
      !glowRef.current ||
      !tailOneRef.current ||
      !tailTwoRef.current
    ) {
      return;
    }

    const finePointerQuery = window.matchMedia("(pointer: fine)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!finePointerQuery.matches) {
      return;
    }

    let animationFrameId = 0;
    let visible = false;
    let lastMoveAt = 0;
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const core = { x: target.x, y: target.y };
    const tailOne = { x: target.x, y: target.y };
    const tailTwo = { x: target.x, y: target.y };

    const rootElement = rootRef.current;
    const coreElement = coreRef.current;
    const haloElement = haloRef.current;
    const glowElement = glowRef.current;
    const tailOneElement = tailOneRef.current;
    const tailTwoElement = tailTwoRef.current;

    function setTransform(element: HTMLDivElement, x: number, y: number, scale: number) {
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
    }

    function setInteractiveState(nextState: boolean) {
      rootElement.dataset.active = nextState ? "true" : "false";
    }

    function animate() {
      const easing = motionQuery.matches ? 0.18 : 0.23;
      const tailEasing = motionQuery.matches ? 0.12 : 0.16;
      const isMoving = performance.now() - lastMoveAt < 140;

      core.x += (target.x - core.x) * easing;
      core.y += (target.y - core.y) * easing;
      tailOne.x += (core.x - tailOne.x) * tailEasing;
      tailOne.y += (core.y - tailOne.y) * tailEasing;
      tailTwo.x += (tailOne.x - tailTwo.x) * (tailEasing * 0.82);
      tailTwo.y += (tailOne.y - tailTwo.y) * (tailEasing * 0.82);

      rootElement.dataset.moving = isMoving ? "true" : "false";

      setTransform(coreElement, core.x, core.y, 1);
      setTransform(haloElement, core.x, core.y, 1);
      setTransform(glowElement, core.x, core.y, motionQuery.matches ? 1 : 1.12);
      setTransform(tailOneElement, tailOne.x, tailOne.y, 1);
      setTransform(tailTwoElement, tailTwo.x, tailTwo.y, 1);

      animationFrameId = window.requestAnimationFrame(animate);
    }

    const handlePointerMove = (event: MouseEvent) => {
      target.x = event.clientX;
      target.y = event.clientY;
      lastMoveAt = performance.now();

      if (!visible) {
        visible = true;
        rootElement.dataset.visible = "true";
      }

      const interactiveTarget = event.target instanceof Element
        ? event.target.closest("a, button, input, textarea, select, label, [role='button']")
        : null;

      setInteractiveState(Boolean(interactiveTarget));
    };

    const handlePointerLeave = () => {
      visible = false;
      rootElement.dataset.visible = "false";
      setInteractiveState(false);
    };

    const handlePointerDown = () => {
      rootElement.dataset.pressed = "true";
    };

    const handlePointerUp = () => {
      rootElement.dataset.pressed = "false";
    };

    animationFrameId = window.requestAnimationFrame(animate);
    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handlePointerLeave, { passive: true });
    window.addEventListener("mousedown", handlePointerDown, { passive: true });
    window.addEventListener("mouseup", handlePointerUp, { passive: true });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handlePointerMove);
      document.documentElement.removeEventListener("mouseleave", handlePointerLeave);
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-visible="false"
      data-active="false"
      data-pressed="false"
      data-moving="false"
      className={joinClasses("cinema-cursor", className)}
    >
      <div ref={tailTwoRef} className="cinema-cursor__trail cinema-cursor__trail--two" />
      <div ref={tailOneRef} className="cinema-cursor__trail cinema-cursor__trail--one" />
      <div ref={haloRef} className="cinema-cursor__halo" />
      <div ref={glowRef} className="cinema-cursor__glow" />
      <div ref={coreRef} className="cinema-cursor__core" />
    </div>
  );
}
