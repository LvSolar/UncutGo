"use client";

import { useEffect, useRef } from "react";

type ParticleBackdropProps = {
  className?: string;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
};

type SceneConfig = {
  count: number;
  linkDistance: number;
  mouseRadius: number;
  speed: number;
};

const DESKTOP_CONFIG: SceneConfig = {
  count: 136,
  linkDistance: 148,
  mouseRadius: 168,
  speed: 0.34,
};

const MOBILE_CONFIG: SceneConfig = {
  count: 58,
  linkDistance: 92,
  mouseRadius: 108,
  speed: 0.18,
};

function joinClasses(...values: Array<string | null | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export default function ParticleBackdrop({ className }: ParticleBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const canvasElement: HTMLCanvasElement = canvasRef.current;

    const resolvedContext = canvasElement.getContext("2d");
    if (!resolvedContext) {
      return;
    }
    const context: CanvasRenderingContext2D = resolvedContext;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: -9999, y: -9999, active: false };
    let animationFrameId = 0;
    let paused = document.hidden;
    let particles: Particle[] = [];
    let config = window.innerWidth < 768 ? MOBILE_CONFIG : DESKTOP_CONFIG;

    function createParticle(width: number, height: number): Particle {
      const velocityScale = config.speed;
      return {
        x: randomBetween(0, width),
        y: randomBetween(0, height),
        vx: randomBetween(-velocityScale, velocityScale),
        vy: randomBetween(-velocityScale, velocityScale),
        size: randomBetween(0.85, 1.95),
      };
    }

    function resizeCanvas() {
      const { innerWidth, innerHeight, devicePixelRatio } = window;
      const dpr = Math.min(devicePixelRatio || 1, 1.8);
      config = innerWidth < 768 ? MOBILE_CONFIG : DESKTOP_CONFIG;

      canvasElement.width = innerWidth * dpr;
      canvasElement.height = innerHeight * dpr;
      canvasElement.style.width = `${innerWidth}px`;
      canvasElement.style.height = `${innerHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      particles = Array.from({ length: config.count }, () => createParticle(innerWidth, innerHeight));
    }

    function handlePointerMove(clientX: number, clientY: number) {
      pointer.x = clientX;
      pointer.y = clientY;
      pointer.active = true;
    }

    function handlePointerLeave() {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
    }

    function drawFrame() {
      const width = window.innerWidth;
      const height = window.innerHeight;

      context.clearRect(0, 0, width, height);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];

        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < -12 || particle.x > width + 12) {
          particle.vx *= -1;
        }

        if (particle.y < -12 || particle.y > height + 12) {
          particle.vy *= -1;
        }

        if (pointer.active && !mediaQuery.matches) {
          const dx = pointer.x - particle.x;
          const dy = pointer.y - particle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < config.mouseRadius && distance > 0.001) {
            const force = (config.mouseRadius - distance) / config.mouseRadius;
            const angle = Math.atan2(dy, dx);
            particle.x -= Math.cos(angle) * force * 2.35;
            particle.y -= Math.sin(angle) * force * 2.35;
          }
        }

        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fillStyle = "rgba(216, 181, 106, 0.88)";
        context.fill();

        for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
          const nextParticle = particles[nextIndex];
          const dx = particle.x - nextParticle.x;
          const dy = particle.y - nextParticle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < config.linkDistance) {
            const opacity = (1 - distance / config.linkDistance) * 0.22;
            context.beginPath();
            context.strokeStyle = `rgba(181, 132, 106, ${opacity})`;
            context.lineWidth = 0.8;
            context.moveTo(particle.x, particle.y);
            context.lineTo(nextParticle.x, nextParticle.y);
            context.stroke();
          }
        }
      }

      if (!paused && !mediaQuery.matches) {
        animationFrameId = window.requestAnimationFrame(drawFrame);
      }
    }

    function renderStaticFrame() {
      const width = window.innerWidth;
      const height = window.innerHeight;

      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fillStyle = "rgba(216, 181, 106, 0.32)";
        context.fill();
      }
    }

    function restartAnimation() {
      window.cancelAnimationFrame(animationFrameId);

      if (paused) {
        return;
      }

      if (mediaQuery.matches) {
        renderStaticFrame();
        return;
      }

      drawFrame();
    }

    function handleVisibilityChange() {
      paused = document.hidden;
      restartAnimation();
    }

    function handleMotionPreferenceChange() {
      restartAnimation();
    }

    const handleMouseMove = (event: MouseEvent) => {
      handlePointerMove(event.clientX, event.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      handlePointerMove(touch.clientX, touch.clientY);
    };

    resizeCanvas();
    restartAnimation();

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseleave", handlePointerLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handlePointerLeave, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    mediaQuery.addEventListener("change", handleMotionPreferenceChange);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handlePointerLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      mediaQuery.removeEventListener("change", handleMotionPreferenceChange);
    };
  }, []);

  return (
    <div aria-hidden="true" className={joinClasses("particle-backdrop", className)}>
      <canvas ref={canvasRef} className="particle-backdrop__canvas" />
    </div>
  );
}
