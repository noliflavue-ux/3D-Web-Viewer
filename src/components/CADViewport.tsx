import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BoundingDimensions,
  CADModelProject,
  CameraPreset,
  StudioTheme,
  ToolMode,
  Vector3Tuple,
} from '../types/cad';
import { buildCADAssemblyGroup } from '../utils/cadGeometryBuilder';
import { soundEngine } from '../utils/soundEngine';
import { MessageSquare, CheckCircle2, Ruler, X } from 'lucide-react';

interface CADViewportProps {
  project: CADModelProject;
  toolMode: ToolMode;
  showDimensions: boolean;
  showCenterOfMass?: boolean;
  showGridFloor?: boolean;
  studioTheme?: StudioTheme;
  autoTurntable?: boolean;
  wireframe: boolean;
  sideBySideExploded: boolean;
  isAutoExploding: boolean;
  cameraPreset: CameraPreset;
  cameraPresetTrigger: number;
  selectedCommentId: string | null;
  onSelectComment: (id: string | null) => void;
  onAddSpatialComment: (position: Vector3Tuple, normal: Vector3Tuple, text: string) => void;
  onCompleteMeasurement: (pointA: Vector3Tuple, pointB: Vector3Tuple) => void;
  onMetricsComputed: (dims: BoundingDimensions, exportPositions: Float32Array) => void;
}

interface ProjectedOverlayItem {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

// Reusable scratch math instances outside render loop (Zero GC)
const _vec3 = new THREE.Vector3();
const _projVec = new THREE.Vector3();

export const CADViewport: React.FC<CADViewportProps> = ({
  project,
  toolMode,
  showDimensions,
  showCenterOfMass = false,
  showGridFloor = true,
  studioTheme = 'vision_spatial',
  autoTurntable = false,
  wireframe,
  sideBySideExploded,
  isAutoExploding,
  cameraPreset,
  cameraPresetTrigger,
  selectedCommentId,
  onSelectComment,
  onAddSpatialComment,
  onCompleteMeasurement,
  onMetricsComputed,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  // Mutable refs so Three.js handlers never tear down the canvas
  const toolModeRef = useRef<ToolMode>(toolMode);
  toolModeRef.current = toolMode;

  const projectRef = useRef<CADModelProject>(project);
  projectRef.current = project;

  const showDimensionsRef = useRef<boolean>(showDimensions);
  showDimensionsRef.current = showDimensions;

  const showCenterOfMassRef = useRef<boolean>(showCenterOfMass);
  showCenterOfMassRef.current = showCenterOfMass;

  const currentComRef = useRef<Vector3Tuple | null>(null);

  const sideBySideRef = useRef<boolean>(sideBySideExploded);
  sideBySideRef.current = sideBySideExploded;

  const autoExplodingRef = useRef<boolean>(isAutoExploding);
  autoExplodingRef.current = isAutoExploding;

  const autoTurntableRef = useRef<boolean>(autoTurntable);
  autoTurntableRef.current = autoTurntable;

  const onCompleteMeasurementRef = useRef(onCompleteMeasurement);
  onCompleteMeasurementRef.current = onCompleteMeasurement;

  const onMetricsComputedRef = useRef(onMetricsComputed);
  onMetricsComputedRef.current = onMetricsComputed;

  // Interactive pending states for 2D/3D HUD overlays
  const [pendingMeasureStart, setPendingMeasureStart] = useState<Vector3Tuple | null>(null);
  const [hoverMeasureEnd, setHoverMeasureEnd] = useState<Vector3Tuple | null>(null);

  const [pendingAnnotationAnchor, setPendingAnnotationAnchor] = useState<{
    position: Vector3Tuple;
    normal: Vector3Tuple;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');

  const [projectedComments, setProjectedComments] = useState<ProjectedOverlayItem[]>([]);
  const [projectedMeasures, setProjectedMeasures] = useState<
    { id: string; x: number; y: number; distanceMm: number; visible: boolean }[]
  >([]);
  const [projectedPendingMeasure, setProjectedPendingMeasure] = useState<{
    x: number;
    y: number;
    distanceMm: number;
    visible: boolean;
  } | null>(null);
  const [projectedCom, setProjectedCom] = useState<{
    x: number;
    y: number;
    visible: boolean;
    coords: Vector3Tuple;
  } | null>(null);

  // Store Three.js scene API in a ref so prop updates trigger coalesced requestRender()
  const sceneApiRef = useRef<{
    rebuildModel: () => void;
    updateExplodedTarget: (factor: number) => void;
    updateSideBySideMode: () => void;
    updateDimensionVisibility: (visible: boolean) => void;
    updateCenterOfMassVisibility: (visible: boolean) => void;
    updateStudioEnvironment: (theme: StudioTheme, gridVisible: boolean, turntable: boolean) => void;
    updateMeasurementLines: () => void;
    flyToPreset: (preset: CameraPreset) => void;
    requestRender: () => void;
  } | null>(null);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Detect software WebGL (SwiftShader / llvmpipe) per Three.js skill
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.userSelect = 'none';
    renderer.domElement.style.webkitUserSelect = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);
    scene.fog = new THREE.FogExp2(0xf1f5f9, 0.0016);

    // 2. Studio Environment Map via RoomEnvironment + PMREMGenerator
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 1200);
    camera.position.set(92, 68, 102);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 17, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.autoRotate = autoTurntableRef.current;
    controls.autoRotateSpeed = 1.6;
    controls.minDistance = 22;
    controls.maxDistance = 420;
    controls.maxPolarAngle = Math.PI / 2 + 0.15;

    // 3. Bright Daylight Architectural Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe2e8f0, 1.25);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(85, 130, 90);
    keyLight.castShadow = !isSoftwareGl;
    if (!isSoftwareGl) {
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -90;
      keyLight.shadow.camera.right = 90;
      keyLight.shadow.camera.top = 90;
      keyLight.shadow.camera.bottom = -90;
      keyLight.shadow.camera.near = 10;
      keyLight.shadow.camera.far = 350;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x0284c7, 0.95);
    rimLight.position.set(-90, 65, -85);
    scene.add(rimLight);

    const accentLight = new THREE.DirectionalLight(0x6366f1, 0.55);
    accentLight.position.set(0, -60, 95);
    scene.add(accentLight);

    // 4. Precision Daylight Floor Grid + Concentric Turntable Rings + Soft Contact Shadow
    const floorGroup = new THREE.Group();
    scene.add(floorGroup);

    const gridHelper = new THREE.GridHelper(260, 26, 0x94a3b8, 0xdbeafe);
    gridHelper.position.y = -0.04;
    floorGroup.add(gridHelper);

    // Concentric CAD turntable rings for Apple VisionOS spatial depth
    const innerRingGeo = new THREE.RingGeometry(48, 48.5, 64);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.32,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = -0.025;
    floorGroup.add(innerRing);

    const outerRingGeo = new THREE.RingGeometry(74, 74.4, 64);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0x64748b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = -0.03;
    floorGroup.add(outerRing);

    const contactShadowGeo = new THREE.CircleGeometry(66, 48);
    const contactCanvas = document.createElement('canvas');
    contactCanvas.width = 128;
    contactCanvas.height = 128;
    const cCtx = contactCanvas.getContext('2d');
    if (cCtx) {
      const grad = cCtx.createRadialGradient(64, 64, 6, 64, 64, 62);
      grad.addColorStop(0, 'rgba(15, 23, 42, 0.22)');
      grad.addColorStop(1, 'rgba(15, 23, 42, 0.0)');
      cCtx.fillStyle = grad;
      cCtx.fillRect(0, 0, 128, 128);
    }
    const contactTex = new THREE.CanvasTexture(contactCanvas);
    const contactMat = new THREE.MeshBasicMaterial({
      map: contactTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.65,
    });
    const contactDisc = new THREE.Mesh(contactShadowGeo, contactMat);
    contactDisc.rotation.x = -Math.PI / 2;
    contactDisc.position.y = -0.015;
    scene.add(contactDisc);

    // Dedicated scene groups
    const cadModelHolder = new THREE.Group();
    scene.add(cadModelHolder);

    const separationVectorsGroup = new THREE.Group();
    scene.add(separationVectorsGroup);

    const bboxHelperGroup = new THREE.Group();
    scene.add(bboxHelperGroup);

    const comHelperGroup = new THREE.Group();
    scene.add(comHelperGroup);

    const measurementLinesGroup = new THREE.Group();
    scene.add(measurementLinesGroup);

    const activeMeasurePreviewGroup = new THREE.Group();
    scene.add(activeMeasurePreviewGroup);

    // Animation & damping state
    let currentExploded = projectRef.current.explodedFactor;
    let targetExploded = projectRef.current.explodedFactor;
    let autoExplodePhase = 0;

    let cameraTransitionActive = false;
    const targetCamPos = new THREE.Vector3();
    const targetCamLook = new THREE.Vector3(0, 18, 0);

    controls.addEventListener('start', () => {
      cameraTransitionActive = false;
    });

    // Software WebGL fence-synced on-demand render scheduler
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTickTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateProjectedOverlays() {
      const fullW = container?.clientWidth || window.innerWidth;
      const h = container?.clientHeight || window.innerHeight;
      const isSplit = sideBySideRef.current;
      const paneW = isSplit ? fullW * 0.5 : fullW;

      camera.aspect = paneW / h;
      camera.updateProjectionMatrix();

      // Project spatial comments (into primary left pane when split, or full viewport)
      const nextComments: ProjectedOverlayItem[] = projectRef.current.comments.map((cmt) => {
        _projVec.set(cmt.position.x, cmt.position.y, cmt.position.z);
        _projVec.project(camera);
        const isBehind = _projVec.z > 1;
        const screenX = ((_projVec.x + 1) / 2) * paneW;
        return {
          id: cmt.id,
          x: screenX,
          y: (-(_projVec.y - 1) / 2) * h,
          visible: !isBehind && screenX >= 0 && screenX <= paneW,
        };
      });
      setProjectedComments(nextComments);

      // Project saved measurement midpoints
      const nextMeasures = projectRef.current.measurements.map((m) => {
        _projVec.set(
          (m.pointA.x + m.pointB.x) / 2,
          (m.pointA.y + m.pointB.y) / 2 + 2.5,
          (m.pointA.z + m.pointB.z) / 2
        );
        _projVec.project(camera);
        const screenX = ((_projVec.x + 1) / 2) * paneW;
        return {
          id: m.id,
          x: screenX,
          y: (-(_projVec.y - 1) / 2) * h,
          distanceMm: m.distanceMm,
          visible: _projVec.z <= 1 && screenX >= 0 && screenX <= paneW,
        };
      });
      setProjectedMeasures(nextMeasures);

      // Project 3D Center of Mass (CoM) callout badge when enabled
      const activeCom = currentComRef.current;
      if (showCenterOfMassRef.current && activeCom) {
        _projVec.set(activeCom.x, activeCom.y + 4.5, activeCom.z);
        _projVec.project(camera);
        const screenX = ((_projVec.x + 1) / 2) * paneW;
        setProjectedCom({
          x: screenX,
          y: (-(_projVec.y - 1) / 2) * h,
          visible: _projVec.z <= 1 && screenX >= 0 && screenX <= paneW,
          coords: activeCom,
        });
      } else {
        setProjectedCom(null);
      }
    }

    function rebuildSeparationVectorLines(factor: number) {
      separationVectorsGroup.clear();
      if (factor <= 0.02) return;

      const root = cadModelHolder.children[0];
      if (!root) return;

      const lineMat = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 2.2,
        gapSize: 1.4,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      });
      const nodeGeo = new THREE.SphereGeometry(1.1, 12, 12);
      const originNodeMat = new THREE.MeshBasicMaterial({ color: 0x64748b, depthTest: false });
      const targetNodeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false });

      root.children.forEach((part) => {
        const partCenter = part.userData.partCenter as THREE.Vector3 | undefined;
        const explodeVec = part.userData.explodeVec as THREE.Vector3 | undefined;
        if (!partCenter || !explodeVec || explodeVec.lengthSq() < 0.5) return;

        const startPt = partCenter.clone();
        const endPt = partCenter.clone().addScaledVector(explodeVec, factor);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([startPt, endPt]);
        const line = new THREE.Line(lineGeo, lineMat);
        line.computeLineDistances();
        line.renderOrder = 995;
        separationVectorsGroup.add(line);

        const startNode = new THREE.Mesh(nodeGeo, originNodeMat);
        startNode.position.copy(startPt);
        startNode.renderOrder = 996;
        separationVectorsGroup.add(startNode);

        const endNode = new THREE.Mesh(nodeGeo, targetNodeMat);
        endNode.position.copy(endPt);
        endNode.renderOrder = 996;
        separationVectorsGroup.add(endNode);
      });
    }

    function applyExplodedPositions(factor: number) {
      const root = cadModelHolder.children[0];
      if (!root) return;
      root.children.forEach((part) => {
        const basePos = part.userData.basePos as THREE.Vector3 | undefined;
        const explodeVec = part.userData.explodeVec as THREE.Vector3 | undefined;
        if (basePos && explodeVec) {
          part.position.copy(basePos).addScaledVector(explodeVec, factor);
        }
      });
      rebuildSeparationVectorLines(factor);
    }

    function renderSceneFrame() {
      const w = container?.clientWidth || window.innerWidth;
      const h = container?.clientHeight || window.innerHeight;

      if (sideBySideRef.current) {
        const halfW = Math.floor(w / 2);
        camera.aspect = halfW / h;
        camera.updateProjectionMatrix();

        renderer.setScissorTest(true);

        // Left Pane: Assembled Reference State (factor = 0)
        applyExplodedPositions(0);
        separationVectorsGroup.visible = false;
        renderer.setViewport(0, 0, halfW, h);
        renderer.setScissor(0, 0, halfW, h);
        renderer.render(scene, camera);

        // Right Pane: Exploded State along Separation Vectors
        const rightFactor =
          currentExploded > 0.03 ? currentExploded : 0.85;
        applyExplodedPositions(rightFactor);
        separationVectorsGroup.visible = true;
        renderer.setViewport(halfW, 0, w - halfW, h);
        renderer.setScissor(halfW, 0, w - halfW, h);
        renderer.render(scene, camera);

        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
      } else {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        applyExplodedPositions(currentExploded);
        separationVectorsGroup.visible = currentExploded > 0.02;
        renderer.render(scene, camera);
      }
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        const dt = Math.min(0.1, (now - lastTickTime) / 1000 || 0.016);
        lastTickTime = now;
        renderDirty = false;

        let needsMoreFrames = false;

        // If continuous auto-explosion animation is active, oscillate smoothly
        if (autoExplodingRef.current) {
          autoExplodePhase += dt * 1.65;
          targetExploded = Number(((Math.sin(autoExplodePhase - Math.PI / 2) + 1) * 0.5).toFixed(3));
          needsMoreFrames = true;
        }

        // Smoothly damp exploded view separation
        if (Math.abs(currentExploded - targetExploded) > 0.002) {
          currentExploded = THREE.MathUtils.damp(currentExploded, targetExploded, 10, dt);
          needsMoreFrames = true;
        } else if (currentExploded !== targetExploded) {
          currentExploded = targetExploded;
        }

        // Smoothly damp camera preset transitions
        if (cameraTransitionActive) {
          const alpha = 1 - Math.exp(-8 * dt);
          camera.position.lerp(targetCamPos, alpha);
          controls.target.lerp(targetCamLook, alpha);
          if (camera.position.distanceToSquared(targetCamPos) < 0.25) {
            camera.position.copy(targetCamPos);
            controls.target.copy(targetCamLook);
            cameraTransitionActive = false;
          } else {
            needsMoreFrames = true;
          }
        }

        if (autoTurntableRef.current) {
          controls.autoRotate = true;
          controls.update();
          needsMoreFrames = true;
        } else {
          controls.autoRotate = false;
          if (controls.enableDamping) {
            if (controls.update()) {
              needsMoreFrames = true;
            }
          } else {
            controls.update();
          }
        }

        renderSceneFrame();
        updateProjectedOverlays();

        if (needsMoreFrames) {
          renderDirty = true;
        }

        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };

        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('change', () => {
      requestRender();
    });

    // Helper to rebuild bounding box wireframe & dimension callouts
    function rebuildBoundingOverlay(targetObj: THREE.Object3D) {
      bboxHelperGroup.clear();
      if (!showDimensionsRef.current) return;

      const box = new THREE.Box3().setFromObject(targetObj);
      if (box.isEmpty()) return;

      const helper = new THREE.Box3Helper(box, new THREE.Color(0x38bdf8));
      bboxHelperGroup.add(helper);
    }

    // Helper to build precision 3D Center of Mass (Schwerpunkt) engineering gizmo
    function rebuildCenterOfMassGizmo(com: Vector3Tuple | null) {
      comHelperGroup.clear();
      if (!showCenterOfMassRef.current || !com) return;

      const anchor = new THREE.Group();
      anchor.position.set(com.x, com.y, com.z);

      const coreMat = new THREE.MeshBasicMaterial({ color: 0xea580c, depthTest: false });
      const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(2.0, 20, 20), coreMat);
      coreSphere.renderOrder = 1002;
      anchor.add(coreSphere);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      });
      const ringXY = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.32, 10, 32), ringMat);
      ringXY.renderOrder = 1001;
      anchor.add(ringXY);

      const ringXZ = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.32, 10, 32), ringMat);
      ringXZ.rotation.x = Math.PI / 2;
      ringXZ.renderOrder = 1001;
      anchor.add(ringXZ);

      const axisLen = 14;
      const axes: [THREE.Vector3, THREE.Vector3, number][] = [
        [new THREE.Vector3(-axisLen, 0, 0), new THREE.Vector3(axisLen, 0, 0), 0xef4444],
        [new THREE.Vector3(0, -axisLen, 0), new THREE.Vector3(0, axisLen, 0), 0x10b981],
        [new THREE.Vector3(0, 0, -axisLen), new THREE.Vector3(0, 0, axisLen), 0x0284c7],
      ];
      for (const [start, end, hex] of axes) {
        const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
        const mat = new THREE.LineBasicMaterial({ color: hex, depthTest: false });
        const line = new THREE.Line(geo, mat);
        line.renderOrder = 1000;
        anchor.add(line);
      }

      comHelperGroup.add(anchor);
    }

    // Helper to rebuild saved measurement lines in 3D space
    function rebuildMeasurementLines() {
      measurementLinesGroup.clear();
      const lineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false });
      const sphereGeo = new THREE.SphereGeometry(1.3, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false });

      for (const m of projectRef.current.measurements) {
        const pts = [
          new THREE.Vector3(m.pointA.x, m.pointA.y, m.pointA.z),
          new THREE.Vector3(m.pointB.x, m.pointB.y, m.pointB.z),
        ];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(lineGeo, lineMat);
        line.renderOrder = 999;
        measurementLinesGroup.add(line);

        pts.forEach((pt) => {
          const marker = new THREE.Mesh(sphereGeo, sphereMat);
          marker.position.copy(pt);
          marker.renderOrder = 999;
          measurementLinesGroup.add(marker);
        });
      }
    }

    // Build CAD geometry & pre-warm shaders
    function rebuildModel() {
      cadModelHolder.clear();
      const built = buildCADAssemblyGroup(projectRef.current, isSoftwareGl, wireframe);
      cadModelHolder.add(built.group);
      currentComRef.current = built.dimensions.physical?.centerOfMassMm ?? null;
      applyExplodedPositions(currentExploded);
      rebuildBoundingOverlay(built.group);
      rebuildCenterOfMassGizmo(currentComRef.current);
      rebuildMeasurementLines();
      onMetricsComputedRef.current(built.dimensions, built.exportPositions);
      requestRender();
    }

    rebuildModel();
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Raycasting for interactive Point-to-Point Measurement & 3D Comment Pin Placement
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let localMeasurePointA: Vector3Tuple | null = null;

    function getMeshIntersection(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      if (sideBySideRef.current) {
        const halfW = rect.width * 0.5;
        const localX = clientX - rect.left;
        const isRightPane = localX >= halfW;
        const paneX = isRightPane ? localX - halfW : localX;
        mouse.x = (paneX / halfW) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        camera.aspect = halfW / rect.height;
        camera.updateProjectionMatrix();
        applyExplodedPositions(isRightPane ? (currentExploded > 0.03 ? currentExploded : 0.85) : 0);
      } else {
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      }
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(cadModelHolder.children, true);
      return hits.length > 0 ? hits[0] : null;
    }

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (toolModeRef.current !== 'measure' || !localMeasurePointA) return;
      const hit = getMeshIntersection(e.clientX, e.clientY);
      activeMeasurePreviewGroup.clear();
      if (hit) {
        const ptB = {
          x: Number(hit.point.x.toFixed(2)),
          y: Number(hit.point.y.toFixed(2)),
          z: Number(hit.point.z.toFixed(2)),
        };
        setHoverMeasureEnd(ptB);

        const pts = [
          new THREE.Vector3(localMeasurePointA.x, localMeasurePointA.y, localMeasurePointA.z),
          hit.point.clone(),
        ];
        const previewGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const previewMat = new THREE.LineDashedMaterial({
          color: 0x38bdf8,
          dashSize: 2,
          gapSize: 1,
          depthTest: false,
        });
        const previewLine = new THREE.Line(previewGeo, previewMat);
        previewLine.computeLineDistances();
        previewLine.renderOrder = 999;
        activeMeasurePreviewGroup.add(previewLine);

        const w = container?.clientWidth || window.innerWidth;
        const h = container?.clientHeight || window.innerHeight;
        _projVec.set(
          (localMeasurePointA.x + ptB.x) / 2,
          (localMeasurePointA.y + ptB.y) / 2 + 3,
          (localMeasurePointA.z + ptB.z) / 2
        );
        _projVec.project(camera);
        const dist = Number(
          Math.sqrt(
            (ptB.x - localMeasurePointA.x) ** 2 +
              (ptB.y - localMeasurePointA.y) ** 2 +
              (ptB.z - localMeasurePointA.z) ** 2
          ).toFixed(2)
        );
        setProjectedPendingMeasure({
          x: ((_projVec.x + 1) / 2) * w,
          y: (-(_projVec.y - 1) / 2) * h,
          distanceMm: dist,
          visible: _projVec.z <= 1,
        });
        requestRender();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moveDist > 6) return; // User was orbiting or panning

      if (toolModeRef.current === 'orbit') return;

      const hit = getMeshIntersection(e.clientX, e.clientY);
      if (!hit) return;

      const hitPoint: Vector3Tuple = {
        x: Number(hit.point.x.toFixed(2)),
        y: Number(hit.point.y.toFixed(2)),
        z: Number(hit.point.z.toFixed(2)),
      };

      if (toolModeRef.current === 'measure') {
        soundEngine.playMeasureSnap();
        if (!localMeasurePointA) {
          localMeasurePointA = hitPoint;
          setPendingMeasureStart(hitPoint);
          activeMeasurePreviewGroup.clear();
          const startMarker = new THREE.Mesh(
            new THREE.SphereGeometry(1.5, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false })
          );
          startMarker.position.set(hitPoint.x, hitPoint.y, hitPoint.z);
          startMarker.renderOrder = 999;
          activeMeasurePreviewGroup.add(startMarker);
          requestRender();
        } else {
          const pointA = localMeasurePointA;
          localMeasurePointA = null;
          setPendingMeasureStart(null);
          setHoverMeasureEnd(null);
          setProjectedPendingMeasure(null);
          activeMeasurePreviewGroup.clear();
          onCompleteMeasurementRef.current(pointA, hitPoint);
          requestRender();
        }
      } else if (toolModeRef.current === 'annotate') {
        soundEngine.playPinDrop();
        const normalVec = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        const rect = renderer.domElement.getBoundingClientRect();
        setPendingAnnotationAnchor({
          position: hitPoint,
          normal: {
            x: Number(normalVec.x.toFixed(2)),
            y: Number(normalVec.y.toFixed(2)),
            z: Number(normalVec.z.toFixed(2)),
          },
          screenX: Math.min(rect.width - 280, Math.max(24, e.clientX - rect.left)),
          screenY: Math.min(rect.height - 200, Math.max(24, e.clientY - rect.top)),
        });
        requestRender();
      }
    };

    const domElem = renderer.domElement;
    domElem.addEventListener('pointerdown', onPointerDown);
    domElem.addEventListener('pointermove', onPointerMove);
    domElem.addEventListener('pointerup', onPointerUp);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setSize(w, h);
      renderSceneFrame();
      updateProjectedOverlays();
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(() => {
      onResize();
    });
    resizeObserver.observe(container);

    // Ensure initial synchronous paint
    renderSceneFrame();
    updateProjectedOverlays();

    sceneApiRef.current = {
      rebuildModel,
      updateExplodedTarget: (factor: number) => {
        targetExploded = factor;
        requestRender();
      },
      updateSideBySideMode: () => {
        if (sideBySideRef.current && targetExploded < 0.05) {
          targetExploded = 0.85;
        }
        renderSceneFrame();
        updateProjectedOverlays();
        requestRender();
      },
      updateDimensionVisibility: (visible: boolean) => {
        showDimensionsRef.current = visible;
        const root = cadModelHolder.children[0];
        if (root) rebuildBoundingOverlay(root);
        requestRender();
      },
      updateCenterOfMassVisibility: (visible: boolean) => {
        showCenterOfMassRef.current = visible;
        rebuildCenterOfMassGizmo(currentComRef.current);
        updateProjectedOverlays();
        requestRender();
      },
      updateStudioEnvironment: (
        theme: StudioTheme,
        gridVisible: boolean,
        turntable: boolean
      ) => {
        floorGroup.visible = gridVisible;
        autoTurntableRef.current = turntable;
        controls.autoRotate = turntable;

        if (theme === 'blueprint_cryo') {
          scene.background = new THREE.Color(0xe0f2fe);
          scene.fog = new THREE.FogExp2(0xe0f2fe, 0.0016);
          rimLight.color.setHex(0x0284c7);
          accentLight.color.setHex(0x0369a1);
        } else if (theme === 'titanium_dark') {
          scene.background = new THREE.Color(0xf8fafc);
          scene.fog = new THREE.FogExp2(0xf8fafc, 0.0015);
          rimLight.color.setHex(0xd97706);
          accentLight.color.setHex(0x64748b);
        } else {
          // vision_spatial (Apple Daylight Studio)
          scene.background = new THREE.Color(0xf1f5f9);
          scene.fog = new THREE.FogExp2(0xf1f5f9, 0.0016);
          rimLight.color.setHex(0x0284c7);
          accentLight.color.setHex(0x6366f1);
        }
        requestRender();
      },
      updateMeasurementLines: () => {
        rebuildMeasurementLines();
        requestRender();
      },
      flyToPreset: (preset: CameraPreset) => {
        targetCamLook.set(0, 17, 0);
        if (preset === 'front') targetCamPos.set(0, 22, 135);
        else if (preset === 'top') targetCamPos.set(0, 155, 0.1);
        else if (preset === 'right') targetCamPos.set(135, 22, 0);
        else targetCamPos.set(92, 68, 102);
        cameraTransitionActive = true;
        requestRender();
      },
      requestRender,
    };

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      domElem.removeEventListener('pointerdown', onPointerDown);
      domElem.removeEventListener('pointermove', onPointerMove);
      domElem.removeEventListener('pointerup', onPointerUp);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Trigger geometry rebuild when project model, SCAD code, parameters, finish, or wireframe changes
  useEffect(() => {
    sceneApiRef.current?.rebuildModel();
  }, [
    project.id,
    project.scadCode,
    project.parameters,
    project.finish,
    project.stlBufferBase64,
    project.stepSourceText,
    wireframe,
  ]);

  // Trigger smooth exploded view damping
  useEffect(() => {
    sceneApiRef.current?.updateExplodedTarget(project.explodedFactor);
  }, [project.explodedFactor]);

  // Trigger side-by-side split view or auto-explosion loop
  useEffect(() => {
    sceneApiRef.current?.updateSideBySideMode();
  }, [sideBySideExploded, isAutoExploding]);

  // Trigger bounding box visibility
  useEffect(() => {
    sceneApiRef.current?.updateDimensionVisibility(showDimensions);
  }, [showDimensions]);

  // Trigger 3D Center of Mass (CoM) gizmo visibility
  useEffect(() => {
    sceneApiRef.current?.updateCenterOfMassVisibility(showCenterOfMass);
  }, [showCenterOfMass]);

  // Trigger studio environment theme, grid visibility, and turntable auto-rotation
  useEffect(() => {
    sceneApiRef.current?.updateStudioEnvironment(studioTheme, showGridFloor, autoTurntable);
  }, [studioTheme, showGridFloor, autoTurntable]);

  // Trigger measurement line sync and comment projection updates
  useEffect(() => {
    sceneApiRef.current?.updateMeasurementLines();
  }, [project.measurements, project.comments]);

  // Trigger camera preset fly-to
  useEffect(() => {
    if (cameraPresetTrigger > 0) {
      sceneApiRef.current?.flyToPreset(cameraPreset);
    }
  }, [cameraPreset, cameraPresetTrigger]);

  // Clear pending measurement if user leaves measure mode
  useEffect(() => {
    if (toolMode !== 'measure') {
      setPendingMeasureStart(null);
      setHoverMeasureEnd(null);
      setProjectedPendingMeasure(null);
    }
    if (toolMode !== 'annotate') {
      setPendingAnnotationAnchor(null);
    }
  }, [toolMode]);

  const handleConfirmAnnotation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAnnotationAnchor || !annotationDraft.trim()) return;
    onAddSpatialComment(
      pendingAnnotationAnchor.position,
      pendingAnnotationAnchor.normal,
      annotationDraft.trim()
    );
    setAnnotationDraft('');
    setPendingAnnotationAnchor(null);
    soundEngine.playSuccessChime();
  };

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-100">
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={canvasMountRef}
        data-testid="cad-webgl-canvas"
        className={`w-full h-full ${
          toolMode === 'measure' || toolMode === 'annotate' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
      />

      {/* Side-by-Side Exploded View Split-Screen Divider & Dual Viewport Headers */}
      {sideBySideExploded && (
        <div
          data-testid="side-by-side-exploded-overlay"
          className="pointer-events-none absolute inset-0 z-10"
        >
          {/* Central Hairline Split Divider */}
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-sky-600/35" />

          {/* Left Pane Callout (Aligned near center split divider) */}
          <div className="absolute top-4 right-[calc(50%+16px)] px-3 py-1.5 rounded-2xl apple-glass-panel text-xs text-slate-700">
            <div className="font-bold text-slate-900">Kompakt-Baugruppe (0% Separation)</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Original-Einbaulage · Synchronisierte Kamera
            </div>
          </div>

          {/* Right Pane Callout (Aligned near center split divider, below Studio bar) */}
          <div className="absolute top-16 left-[calc(50%+16px)] px-3 py-1.5 rounded-2xl apple-glass-panel border-sky-500/40 text-xs text-slate-700">
            <div className="font-bold text-sky-700">
              Explosionsansicht · Separationsvektoren ({Math.round((project.explodedFactor > 0.03 ? project.explodedFactor : 0.85) * 100)}%)
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Normal- &amp; Axialvektoren
            </div>
          </div>
        </div>
      )}

      {/* Active Tool Mode Floating Instruction Banner (Top-Center, non-obstructive) */}
      {toolMode !== 'orbit' && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-3 px-4 py-2 rounded-2xl apple-glass-panel border-sky-500/40 text-xs text-slate-800 font-medium">
            {toolMode === 'measure' ? (
              <>
                <Ruler className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  {pendingMeasureStart
                    ? `Startpunkt (${pendingMeasureStart.x}, ${pendingMeasureStart.y}, ${pendingMeasureStart.z}) gesetzt — Klicke auf den 2. Bauteilpunkt`
                    : 'Punkt-zu-Punkt Messung aktiv: Klicke zwei beliebige Punkte direkt auf dem 3D-Bauteil an'}
                </span>
              </>
            ) : (
              <>
                <MessageSquare className="w-4 h-4 text-sky-600 shrink-0" />
                <span>3D-Team-Pin aktiv: Klicke direkt auf eine Bauteilfläche, um einen 3D-Kommentar anzuheften</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Projected 3D Spatial Comment Pins */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {project.comments.map((cmt, index) => {
          const proj = projectedComments.find((p) => p.id === cmt.id);
          if (!proj || !proj.visible) return null;
          const isSelected = selectedCommentId === cmt.id;

          return (
            <div
              key={cmt.id}
              style={{
                transform: `translate3d(${Math.round(proj.x)}px, ${Math.round(proj.y)}px, 0)`,
              }}
              className="pointer-events-auto absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
            >
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  onSelectComment(isSelected ? null : cmt.id);
                }}
                aria-label={`3D Pin ${index + 1}: ${cmt.authorName}`}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-bold border shadow-md transition-all cursor-pointer ${
                  isSelected
                    ? 'apple-glass-cta text-white border-sky-600 scale-110'
                    : cmt.resolved
                    ? 'bg-white/95 text-emerald-700 border-emerald-500/50 hover:border-emerald-600'
                    : 'bg-white/95 text-sky-700 border-sky-500/40 hover:bg-sky-50 hover:text-sky-900'
                }`}
              >
                <span>#{index + 1}</span>
                {cmt.resolved && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
              </button>

              {isSelected && (
                <div className="mt-2 w-64 p-3.5 rounded-2xl apple-glass-panel text-left">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span className="font-bold text-slate-900">{cmt.authorName}</span>
                    <span>
                      {cmt.authorRole} · v{cmt.versionNumber}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{cmt.text}</p>
                  <div className="mt-2 pt-1.5 border-t border-slate-200 flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>
                      XYZ ({cmt.position.x}, {cmt.position.y}, {cmt.position.z}) mm
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectComment(null)}
                      className="text-sky-600 font-semibold hover:underline cursor-pointer"
                    >
                      Schließen
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Projected Saved Measurement Callouts */}
        {projectedMeasures.map((m) =>
          m.visible ? (
            <div
              key={m.id}
              style={{
                transform: `translate3d(${Math.round(m.x)}px, ${Math.round(m.y)}px, 0)`,
              }}
              className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded-lg bg-white/95 border border-amber-500/60 text-[11px] font-mono font-bold text-amber-700 shadow-sm"
            >
              {m.distanceMm.toFixed(2)} mm
            </div>
          ) : null
        )}

        {/* Projected 3D Center of Mass (CoM) Callout Badge */}
        {showCenterOfMass && projectedCom && projectedCom.visible && (
          <div
            data-testid="viewport-com-badge"
            style={{
              transform: `translate3d(${Math.round(projectedCom.x)}px, ${Math.round(projectedCom.y)}px, 0)`,
            }}
            className="absolute top-0 left-0 -translate-x-1/2 -translate-y-full -mt-2 px-2.5 py-1 rounded-lg bg-white/95 border border-orange-500/60 text-[11px] font-mono font-bold text-orange-700 shadow-md whitespace-nowrap"
          >
            CoM ({projectedCom.coords.x.toFixed(1)}, {projectedCom.coords.y.toFixed(1)},{' '}
            {projectedCom.coords.z.toFixed(1)}) mm
          </div>
        )}

        {/* Live Preview Distance Callout while Measuring */}
        {projectedPendingMeasure && projectedPendingMeasure.visible && hoverMeasureEnd && (
          <div
            style={{
              transform: `translate3d(${Math.round(projectedPendingMeasure.x)}px, ${Math.round(
                projectedPendingMeasure.y
              )}px, 0)`,
            }}
            className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg apple-glass-cta text-white text-xs font-mono font-bold shadow-lg"
          >
            Δ {projectedPendingMeasure.distanceMm.toFixed(2)} mm
          </div>
        )}
      </div>

      {/* Popover Form when dropping a new 3D Comment Pin */}
      {pendingAnnotationAnchor && (
        <div
          style={{
            left: `${pendingAnnotationAnchor.screenX}px`,
            top: `${pendingAnnotationAnchor.screenY}px`,
          }}
          className="absolute z-30 w-72 p-4 rounded-2xl apple-glass-panel border-sky-500/40"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-sky-700">
              Neuer 3D-Bauteilkommentar
            </span>
            <button
              type="button"
              aria-label="Kommentar abbrechen"
              onClick={() => setPendingAnnotationAnchor(null)}
              className="text-slate-400 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-[11px] font-mono text-slate-500 mb-2">
            Koordinate: X {pendingAnnotationAnchor.position.x} · Y {pendingAnnotationAnchor.position.y} · Z{' '}
            {pendingAnnotationAnchor.position.z} mm
          </div>
          <form onSubmit={handleConfirmAnnotation}>
            <label htmlFor="spatial-comment-input" className="sr-only">
              Kommentartext eingeben
            </label>
            <textarea
              id="spatial-comment-input"
              rows={3}
              value={annotationDraft}
              onChange={(e) => setAnnotationDraft(e.target.value)}
              placeholder="z.B. Fase 1.5mmx45° an dieser Kante ergänzen..."
              className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
              autoFocus
            />
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAnnotationAnchor(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold apple-glass-cta text-white cursor-pointer"
              >
                Pin speichern
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
