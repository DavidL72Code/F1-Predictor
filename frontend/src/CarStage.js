import { useEffect, useRef, useState } from "react"

const MODEL_URL = `${process.env.PUBLIC_URL}/f1-car.glb`

/* The Blender carbon shader did not survive the glTF export: "Exposed carbon"
   — 92 of the model's 237 primitives, so every wing, the floor, bargeboards
   and suspension — ships with no baseColorFactor and no baseColorTexture. The
   glTF default is [1,1,1,1], which at 0.7 metallic renders as bright white
   metal. Everything else in the model is properly authored, so this is the one
   material we override. */
const MATERIAL_FIXES = {
  "Exposed carbon": { color: 0x0b0b0f, roughness: 0.35 },
}

/* The model is normalised so its longest axis is 1 unit; that axis is the
   car's length, which is what has to fit across the frame. */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/* Share of the frame width the car should span. A wide desktop frame wants
   air around the car; a near-square phone band would look empty at the same
   ratio, so narrow aspects fill more. Capped below 1 so the widest pose still
   keeps its wing tips inside the frame. */
const fillForAspect = (aspect) => 0.64 + 0.22 * clamp01((1.4 - aspect) / 0.6)
const MAX_FILL = 0.88

/* The bounding box is measured at the object's centre, but the near half of
   the car projects larger than that. Without this allowance the widest pose
   overflows the frame it was supposedly framed to fit. */
const PERSPECTIVE_ALLOWANCE = 1.08

/* One yaw per scene, in radians. The car never doubles back: front
   three-quarter, then the opposite three-quarter half a turn later, then round
   to a near-side profile for the feature callouts — the flattest view, so each
   pill has a distinct part of the car to sit beside. */
const YAW_KEYS = [-0.62, 2.52, 3.32]

const lerp = (a, b, t) => a + (b - a) * t

/* `turn` runs 0 → 1 → 2 across the two hand-overs; read it as a position
   along YAW_KEYS. */
const yawAt = (turn) => {
  const i = Math.max(0, Math.min(Math.floor(turn), YAW_KEYS.length - 2))
  return lerp(YAW_KEYS[i], YAW_KEYS[i + 1], turn - i)
}

export default function CarStage({ progress }) {
  const hostRef = useRef(null)
  const [status, setStatus] = useState("loading")

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    let disposed = false
    let cleanup = () => {}

    /* three is ~150 kB gzipped — as much as the rest of the app. Loading it in
       its own chunk keeps the headline interactive on first paint and lets the
       car arrive whenever it is ready. */
    const boot = async () => {
      /* The model is bigger than all the three.js chunks combined, so it is
         requested up front rather than after the imports resolve. Chaining the
         two made the car arrive seconds late and look like it was missing. */
      const modelBytes = fetch(MODEL_URL).then((r) => {
        if (!r.ok) throw new Error(`model request failed: ${r.status}`)
        return r.arrayBuffer()
      })

      const [THREE, { GLTFLoader }, { MeshoptDecoder }, { RoomEnvironment }, bytes] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
        modelBytes,
      ])
      if (disposed) return

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" })
      /* Capped at 1.5 rather than 2: on a retina laptop the full-viewport
         canvas is otherwise a 2870x1800 (5.2 MP) buffer redrawn every frame.
         With MSAA on, the visible difference on a car silhouette is slight;
         the fill-rate saving is ~45%. */
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.92
      renderer.outputColorSpace = THREE.SRGBColorSpace
      host.appendChild(renderer.domElement)
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block"

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)

      /* A room environment gives the carbon and gloss something to reflect.
         Without it the bodywork reads as flat grey plastic. */
      const pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      /* The livery is 0.82 metallic, so it reflects the environment almost
         mirror-like. At full strength the bright room washes the midnight-blue
         bodywork and red wings out to white — keep it as a subtle sheen. */
      scene.environmentIntensity = 0.4

      const key = new THREE.DirectionalLight(0xffffff, 3.1)
      key.position.set(4, 6, 5)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0xff4466, 1.25)
      rim.position.set(-5, 2.5, -4)
      scene.add(rim)
      const fillLight = new THREE.DirectionalLight(0x88aaff, 0.9)
      fillLight.position.set(-3, 1.5, 5)
      scene.add(fillLight)
      scene.add(new THREE.HemisphereLight(0xaaccff, 0x181820, 0.55))

      const pivot = new THREE.Group()
      scene.add(pivot)

      /* Soft contact shadow. A real shadow map on 200k triangles costs more
         than it returns here; a painted blob grounds the car just as well. */
      const shadowCanvas = document.createElement("canvas")
      shadowCanvas.width = shadowCanvas.height = 256
      const sctx = shadowCanvas.getContext("2d")
      const grd = sctx.createRadialGradient(128, 128, 4, 128, 128, 124)
      grd.addColorStop(0, "rgba(0,0,0,0.85)")
      grd.addColorStop(0.45, "rgba(0,0,0,0.42)")
      grd.addColorStop(1, "rgba(0,0,0,0)")
      sctx.fillStyle = grd
      sctx.fillRect(0, 0, 256, 256)
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(shadowCanvas),
          transparent: true,
          depthWrite: false,
        })
      )
      shadow.rotation.x = -Math.PI / 2
      pivot.add(shadow)

      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)

      const gltf = await new Promise((resolve, reject) => loader.parse(bytes, "", resolve, reject))
      if (disposed) return

      const car = gltf.scene

      car.traverse((obj) => {
        if (!obj.material) return
        for (const material of [].concat(obj.material)) {
          const fix = MATERIAL_FIXES[material.name]
          if (!fix) continue
          material.color.setHex(fix.color)
          if (fix.roughness !== undefined) material.roughness = fix.roughness
        }
      })

      /* Normalise whatever the export happened to use: recentre on the origin
         and scale the longest axis to 1 so the framing below is predictable. */
      const box = new THREE.Box3().setFromObject(car)
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      const unit = 1 / Math.max(size.x, size.y, size.z)
      car.scale.setScalar(unit)
      car.position.set(-centre.x * unit, -box.min.y * unit, -centre.z * unit)
      pivot.add(car)

      /* Normalised plan-view extents, used to work out how wide the car
         projects at any given yaw. */
      const footprintX = size.x * unit
      const footprintZ = size.z * unit
      const footprint = Math.max(footprintX, footprintZ)
      shadow.scale.setScalar(footprint * 1.65)
      shadow.position.y = 0.002

      const resize = () => {
        const w = host.clientWidth
        const h = host.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(host)

      setStatus("ready")

      /* Only burn frames while the intro is actually on screen. */
      let onScreen = true
      const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting }, { threshold: 0 })
      io.observe(host)

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      const clock = new THREE.Clock()
      let frame = 0

      let lastTurn = -1
      let lastT = -1

      const render = () => {
        frame = requestAnimationFrame(render)
        if (!onScreen) return

        const { t, turn, active } = progress.current
        if (active === false) return

        /* With motion reduced there is no idle float, so a frame where scroll
           has not moved would be pixel-identical — skip it rather than redraw
           the whole buffer. */
        if (reduceMotion && turn === lastTurn && t === lastT) return
        lastTurn = turn
        lastT = t

        const time = clock.getElapsedTime()

        /* 0 while a scene is held, 1 at the midpoint of whichever hand-over is
           running. `turn` is eased separately from `t`, so the car is moving
           fastest at exactly the moment the letters are. */
        const heat = Math.sin(Math.PI * (turn % 1))

        pivot.rotation.y = yawAt(turn)
        pivot.rotation.z = heat * 0.07
        pivot.position.y = heat * 0.06 + (reduceMotion ? 0 : Math.sin(time * 0.9) * 0.006)
        shadow.material.opacity = 1 - heat * 0.55

        /* Frame by width rather than by a fixed distance. The car is long and
           thin, so a distance tuned for a 16:9 desktop crops it off both edges
           on a portrait phone. Solving for the horizontal FOV keeps it filling
           the same share of the width at any aspect ratio.

           The span is recomputed from the current yaw, not assumed: the car is
           ~3x longer than it is wide, so a side profile projects far wider than
           a three-quarter. Framing against a fixed span makes the scenes drift
           in size and overflows the widest one. */
        const yaw = pivot.rotation.y
        const span =
          (Math.abs(footprintX * Math.cos(yaw)) + Math.abs(footprintZ * Math.sin(yaw))) *
          PERSPECTIVE_ALLOWANCE

        const vFov = (camera.fov * Math.PI) / 180
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
        /* The push-in scales the fill target, then clamps — otherwise it
           compounds on top of an already-wide phone fill and crops. */
        const fill = Math.min(fillForAspect(camera.aspect) * lerp(1, 1.08, t), MAX_FILL)
        const dist = span / fill / (2 * Math.tan(hFov / 2))

        /* Drops from a raised hero angle to near eye level, so scene 2 sits
           lower in frame like the reference. */
        camera.position.set(0, dist * lerp(0.33, 0.21, t), dist)
        camera.lookAt(0, lerp(0.24, 0.19, t), 0)

        renderer.render(scene, camera)
      }
      render()

      cleanup = () => {
        cancelAnimationFrame(frame)
        ro.disconnect()
        io.disconnect()
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose()
          if (o.material) [].concat(o.material).forEach((m) => m.dispose())
        })
        scene.environment?.dispose()
        pmrem.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    }

    /* boot() is async and nothing awaits it, so without this a thrown error
       becomes a silent unhandled rejection and the car just never appears. */
    boot().catch((err) => {
      if (disposed) return
      console.error("[CarStage] could not start the 3D scene:", err)
      setStatus("failed")
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [progress])

  return (
    <div className={`si-car si-car-${status}`} ref={hostRef} aria-hidden="true">
      {status === "loading" && <span className="si-car-loading">LOADING CAR</span>}
    </div>
  )
}
