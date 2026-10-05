/**
 * Full 3D Anatomy Volume Viewer - Main Application Logic
 * Integrates NiiVue WebGL Volume Raycaster, Reference Scans,
 * Tissue Isolation Presets, 6DoF Tangible Slicing, AR Camera Stream,
 * Autostereoscopic Holographic 3D, and DICOM slice stacking / WASM conversion.
 * Shows Whole 3D Volume on first view and features 2-click Undo/Toggle behavior.
 */

// DOM Elements
const canvas = document.getElementById("gl-canvas");
const slider = document.getElementById("clip-slider");
const depthTxt = document.getElementById("depth-txt");
const axisBtns = document.querySelectorAll("#axis-btns button");
const tissuePreset = document.getElementById("tissue-preset");
const cmapSelect = document.getElementById("cmap-select");
const threshSlider = document.getElementById("thresh-slider");
const threshTxt = document.getElementById("thresh-txt");
const filePick = document.getElementById("file-pick");
const loader = document.getElementById("loader");
const sliceCounter = document.getElementById("slice-counter");
const loadBrainBtn = document.getElementById("load-brain");
const loadHeadBtn = document.getElementById("load-head");

// Mode & Gizmo Elements
const modeBtns = document.querySelectorAll("#slicing-modes button");
const propControls = document.getElementById("prop-controls");
const standardSliceControls = document.getElementById("standard-slice-controls");
const pitchSlider = document.getElementById("pitch-slider");
const yawSlider = document.getElementById("yaw-slider");
const rollSlider = document.getElementById("roll-slider");
const pitchTxt = document.getElementById("pitch-txt");
const yawTxt = document.getElementById("yaw-txt");
const rollTxt = document.getElementById("roll-txt");
const arVideo = document.getElementById("ar-video");
const holoGrid = document.getElementById("holo-grid");
const slicingGizmoSvg = document.getElementById("slicing-gizmo-svg");
const pillMode = document.getElementById("pill-mode");
const pillHolo = document.getElementById("pill-holo");

// File Protocol Server Check
if (location.protocol === "file:") {
  const banner = document.getElementById("file-banner");
  if (banner) {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 2500);
    fetch("http://localhost:8000/index.html", { mode: "no-cors", cache: "no-store", signal: ctrl.signal })
      .then(() => location.replace("http://localhost:8000/"))
      .catch(() => { banner.style.display = "block"; });
  }
}

// Initialize WebGL Volume Raycasting Engine
const nv = new niivue.Niivue({
  backColor: [0.02, 0.03, 0.05, 1.0],
  show3Dcrosshair: false,
  loadingText: ''
});

nv.attachToCanvas(canvas);
nv.setSliceType(nv.sliceTypeRender);

// State Variables
let currentAxis = 'axial';
let currentMode = 'standard';
let isArActive = false;
let isHoloActive = false;
let lastStateBeforeReset = null;

// Helper UI Load Indicators
function showLoader(text) {
  if (loader) {
    loader.textContent = text || "Loading 3D Scan...";
    loader.style.display = 'block';
  }
}

function hideLoader() {
  if (loader) {
    loader.style.display = 'none';
  }
}

/**
 * Update Clip Plane Vector based on active orientation mode and distance depth.
 * When depth is 0 mm, shows the WHOLE 3D volume uncut.
 */
function updatePlane() {
  const dist = parseFloat(slider ? slider.value : 0);
  
  if (depthTxt) {
    depthTxt.textContent = (dist === 0) ? "0 mm (Whole 3D Image)" : dist + " mm";
  }

  if (dist === 0) {
    // Show full 3D image without clipping
    nv.setClipPlane([0, 0, 0, 0]);
    if (slicingGizmoSvg) slicingGizmoSvg.classList.remove('active');
    return;
  }

  if (currentMode === 'standard') {
    if (currentAxis === 'axial') nv.setClipPlane([0, 0, 1, dist]);
    if (currentAxis === 'coronal') nv.setClipPlane([0, 1, 0, dist]);
    if (currentAxis === 'sagittal') nv.setClipPlane([1, 0, 0, dist]);
  } else if (currentMode === 'prop6dof' || currentMode === 'arwindow') {
    const pitch = parseFloat(pitchSlider.value) * (Math.PI / 180);
    const yaw = parseFloat(yawSlider.value) * (Math.PI / 180);

    if (pitchTxt) pitchTxt.textContent = pitchSlider.value + "°";
    if (yawTxt) yawTxt.textContent = yawSlider.value + "°";
    if (rollTxt) rollTxt.textContent = rollSlider.value + "°";

    const nx = Math.sin(yaw) * Math.cos(pitch);
    const ny = -Math.sin(pitch);
    const nz = Math.cos(yaw) * Math.cos(pitch);

    nv.setClipPlane([nx, ny, nz, dist]);
    updateGizmoOverlay(nx, ny, nz, dist);
  }
}

/**
 * Update SVG 6DoF Tangible Slicing Gizmo Overlay
 */
function updateGizmoOverlay(nx, ny, nz, d) {
  if (!slicingGizmoSvg) return;
  if (currentMode !== 'prop6dof') {
    slicingGizmoSvg.classList.remove('active');
    return;
  }
  slicingGizmoSvg.classList.add('active');

  const cx = 500 + nx * d * 1.5;
  const cy = 500 + ny * d * 1.5;
  const size = 250;

  const p1 = `${cx - size},${cy - size}`;
  const p2 = `${cx + size},${cy - size}`;
  const p3 = `${cx + size},${cy + size}`;
  const p4 = `${cx - size},${cy + size}`;

  const quad = document.getElementById('gizmo-quad');
  const center = document.getElementById('gizmo-center');
  const normal = document.getElementById('gizmo-normal');

  if (quad) quad.setAttribute('points', `${p1} ${p2} ${p3} ${p4}`);
  if (center) {
    center.setAttribute('cx', cx);
    center.setAttribute('cy', cy);
  }
  if (normal) {
    normal.setAttribute('x1', cx);
    normal.setAttribute('y1', cy);
    normal.setAttribute('x2', cx + nx * 100);
    normal.setAttribute('y2', cy + ny * 100);
  }
}

/**
 * Load Reference Volume by URL and present whole 3D image on first view
 */
async function loadVolumeByUrl(url, defaultColormap = "gray", label = "3D Scan") {
  showLoader(`Loading ${label}...`);
  try {
    await nv.loadVolumes([{ url, colormap: defaultColormap, opacity: 1.0 }]);
    nv.setSliceType(nv.sliceTypeRender);
    
    // First view: show the WHOLE 3D volume (no clipping cuts)
    if (slider) slider.value = 0;
    nv.setClipPlane([0, 0, 0, 0]);

    if (cmapSelect) cmapSelect.value = defaultColormap;
    if (sliceCounter) sliceCounter.textContent = label;
    
    updatePlane();
  } catch (err) {
    console.error("Failed to load volume by URL:", err);
    alert("Failed to load volume: " + (err && err.message ? err.message : err));
  } finally {
    hideLoader();
  }
}

// Initial Volume Load (Default: Complete MNI152 3D Volumetric Brain - Whole 3D Image)
loadVolumeByUrl("https://niivue.github.io/niivue-demo-images/mni152.nii.gz", "gray", "Full Brain MRI");
if (loadBrainBtn) loadBrainBtn.classList.add("active");

// Quick Reference Load Event Handlers with 2-Click Undo Toggle
if (loadBrainBtn) {
  loadBrainBtn.addEventListener("click", () => {
    if (loadBrainBtn.classList.contains("active")) {
      // 2nd Click: Undo selection & reset to whole 3D image view
      loadBrainBtn.classList.remove("active");
      if (slider) slider.value = 0;
      updatePlane();
      if (nv.scene) {
        nv.scene.renderAzimuth = 0;
        nv.scene.renderElevation = 0;
        nv.scene.volScale = 1.0;
        nv.drawScene();
      }
      return;
    }
    if (loadHeadBtn) loadHeadBtn.classList.remove("active");
    loadBrainBtn.classList.add("active");
    loadVolumeByUrl("https://niivue.github.io/niivue-demo-images/mni152.nii.gz", "gray", "Full Brain MRI");
  });
}

if (loadHeadBtn) {
  loadHeadBtn.addEventListener("click", () => {
    if (loadHeadBtn.classList.contains("active")) {
      // 2nd Click: Undo selection & reset to whole 3D image view
      loadHeadBtn.classList.remove("active");
      if (slider) slider.value = 0;
      updatePlane();
      if (nv.scene) {
        nv.scene.renderAzimuth = 0;
        nv.scene.renderElevation = 0;
        nv.scene.volScale = 1.0;
        nv.drawScene();
      }
      return;
    }
    if (loadBrainBtn) loadBrainBtn.classList.remove("active");
    loadHeadBtn.classList.add("active");
    loadVolumeByUrl("https://niivue.github.io/niivue-demo-images/visiblehuman.nii.gz", "bone", "Skull & Head CT");
  });
}

// Tissue Isolation Presets (Bone, Soft Tissue, Vascular, Lung, Full Density)
function applyTissuePreset(preset) {
  if (!nv.volumes.length) return;
  const vol = nv.volumes[0];

  switch (preset) {
    case 'bone':
      vol.cal_min = 200;
      vol.cal_max = 1200;
      if (cmapSelect) cmapSelect.value = 'bone';
      nv.setColorMap(vol.id, 'bone');
      break;
    case 'soft':
      vol.cal_min = 20;
      vol.cal_max = 140;
      if (cmapSelect) cmapSelect.value = 'gray';
      nv.setColorMap(vol.id, 'gray');
      break;
    case 'angio':
      vol.cal_min = 150;
      vol.cal_max = 600;
      if (cmapSelect) cmapSelect.value = 'ct_kidneys';
      nv.setColorMap(vol.id, 'ct_kidneys');
      break;
    case 'lung':
      vol.cal_min = -900;
      vol.cal_max = -200;
      if (cmapSelect) cmapSelect.value = 'copper';
      nv.setColorMap(vol.id, 'copper');
      break;
    case 'all':
    default:
      vol.cal_min = null;
      vol.cal_max = null;
      break;
  }
  nv.updateGLVolume();
}

if (tissuePreset) {
  tissuePreset.addEventListener("change", (e) => {
    applyTissuePreset(e.target.value);
  });
}

if (cmapSelect) {
  cmapSelect.addEventListener("change", (e) => {
    if (nv.volumes.length) {
      nv.setColorMap(nv.volumes[0].id, e.target.value);
      nv.updateGLVolume();
    }
  });
}

if (threshSlider) {
  threshSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    if (threshTxt) threshTxt.textContent = val + "%";
    if (nv.volumes.length) {
      const vol = nv.volumes[0];
      const minVal = vol.cal_min || 0;
      const maxVal = vol.cal_max || 1000;
      const adjustedMin = minVal + (maxVal - minVal) * (val / 100) * 0.4;
      nv.setCalMinMax(vol.id, adjustedMin, maxVal);
    }
  });
}

// Plane Axis Event Listeners with 2-Click Reset/Undo Depth Offset
if (slider) slider.addEventListener("input", updatePlane);
if (pitchSlider) pitchSlider.addEventListener("input", updatePlane);
if (yawSlider) yawSlider.addEventListener("input", updatePlane);
if (rollSlider) rollSlider.addEventListener("input", updatePlane);

axisBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("active")) {
      // 2nd Click on active axis button: Undo clip plane depth offset back to 0 mm (Whole 3D Volume)
      if (slider) slider.value = 0;
      updatePlane();
      return;
    }
    axisBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentAxis = btn.dataset.axis;
    updatePlane();
  });
});

// Spatial Tracking Modes with 2-Click Undo to Standard Axis Mode
modeBtns.forEach(b => {
  b.addEventListener("click", () => {
    if (b.classList.contains("active") && b.dataset.mode !== "standard") {
      // 2nd Click: Undo non-standard mode and revert back to Standard Axis
      b.classList.remove("active");
      const stdBtn = document.querySelector('.mode-btn[data-mode="standard"]');
      if (stdBtn) stdBtn.classList.add("active");
      currentMode = 'standard';
      if (propControls) propControls.style.display = 'none';
      if (standardSliceControls) standardSliceControls.style.display = 'block';
      if (pillMode) pillMode.innerHTML = `<span class="status-dot"></span> Slicing: Standard Axis`;
      if (isArActive) toggleAR(false);
      if (isHoloActive) toggleHolographic(false);
      if (slicingGizmoSvg) slicingGizmoSvg.classList.remove('active');
      updatePlane();
      return;
    }

    modeBtns.forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    currentMode = b.dataset.mode;

    if (propControls) propControls.style.display = (currentMode === 'prop6dof') ? 'block' : 'none';
    if (standardSliceControls) standardSliceControls.style.display = (currentMode === 'standard') ? 'block' : 'none';

    if (pillMode) {
      const labelText = b.querySelector('strong') ? b.querySelector('strong').textContent : b.textContent;
      pillMode.innerHTML = `<span class="status-dot"></span> Slicing: ${labelText}`;
      pillMode.classList.add('active');
    }

    if (currentMode === 'arwindow') {
      toggleAR(true);
    } else if (currentMode === 'holographic') {
      toggleHolographic(true);
    } else {
      if (slicingGizmoSvg) slicingGizmoSvg.classList.remove('active');
    }

    updatePlane();
  });
});

// AR Camera Feed Toggle (1st click ON, 2nd click OFF/Undo)
async function toggleAR(enable) {
  isArActive = (enable !== undefined) ? enable : !isArActive;
  const btn = document.getElementById('btn-ar-toggle');
  if (btn) btn.classList.toggle('active', isArActive);

  if (!arVideo) return;

  if (isArActive) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      arVideo.srcObject = stream;
      arVideo.classList.add('active');
      nv.setOption('backColor', [0, 0, 0, 0]);
    } catch (err) {
      console.warn("Camera AR stream failed:", err);
      alert("AR Video Stream: Camera access denied or unavailable.");
      isArActive = false;
      if (btn) btn.classList.remove('active');
    }
  } else {
    if (arVideo.srcObject) {
      arVideo.srcObject.getTracks().forEach(t => t.stop());
      arVideo.srcObject = null;
    }
    arVideo.classList.remove('active');
    nv.setOption('backColor', [0.02, 0.03, 0.05, 1.0]);
  }
}

const btnArToggle = document.getElementById('btn-ar-toggle');
if (btnArToggle) btnArToggle.addEventListener('click', () => toggleAR());

// Holographic Autostereoscopic Parallax Toggle (1st click ON, 2nd click OFF/Undo)
function toggleHolographic(enable) {
  isHoloActive = (enable !== undefined) ? enable : !isHoloActive;
  const btn = document.getElementById('btn-holo-toggle');
  if (btn) btn.classList.toggle('active', isHoloActive);
  if (holoGrid) holoGrid.classList.toggle('active', isHoloActive);
  if (pillHolo) pillHolo.classList.toggle('active', isHoloActive);
}

const btnHoloToggle = document.getElementById('btn-holo-toggle');
if (btnHoloToggle) btnHoloToggle.addEventListener('click', () => toggleHolographic());

// Mouse Parallax for Autostereoscopic 3D
window.addEventListener('mousemove', (e) => {
  if (!isHoloActive) return;
  const mouseX = (e.clientX / window.innerWidth) - 0.5;
  const mouseY = (e.clientY / window.innerHeight) - 0.5;
  nv.scene.renderAzimuth = mouseX * 30;
  nv.scene.renderElevation = mouseY * 30;
  nv.drawScene();
});

// Gyroscope Mobile Orientation
if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientation', (e) => {
    if (currentMode === 'arwindow' || isHoloActive) {
      if (e.beta !== null && e.gamma !== null) {
        if (pitchSlider) pitchSlider.value = Math.round(e.beta - 45);
        if (yawSlider) yawSlider.value = Math.round(e.gamma);
        updatePlane();
      }
    }
  });
}

// Touch Direct Manipulation (Dual-Finger Pinch Scale)
let initialPinchDist = 0;

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    initialPinchDist = Math.sqrt(dx * dx + dy * dy);
  }
});

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && initialPinchDist > 0) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const currentDist = Math.sqrt(dx * dx + dy * dy);
    const scaleFactor = currentDist / initialPinchDist;

    if (nv.scene) {
      nv.scene.volScale = (nv.scene.volScale || 1.0) * (scaleFactor > 1 ? 1.02 : 0.98);
      nv.drawScene();
    }
  }
});

canvas.addEventListener('touchend', () => { initialPinchDist = 0; });

// Reset Button with 2-Click Undo (1st click resets view, 2nd click undoes reset and restores previous state)
const btnReset = document.getElementById('btn-reset');
if (btnReset) {
  btnReset.addEventListener('click', () => {
    if (btnReset.classList.contains("active") && lastStateBeforeReset) {
      // 2nd Click: Undo reset and restore previous settings
      btnReset.classList.remove("active");
      if (slider) slider.value = lastStateBeforeReset.slider;
      if (pitchSlider) pitchSlider.value = lastStateBeforeReset.pitch;
      if (yawSlider) yawSlider.value = lastStateBeforeReset.yaw;
      if (rollSlider) rollSlider.value = lastStateBeforeReset.roll;
      if (threshSlider) threshSlider.value = lastStateBeforeReset.thresh;
      if (nv.scene) {
        nv.scene.renderAzimuth = lastStateBeforeReset.azimuth;
        nv.scene.renderElevation = lastStateBeforeReset.elevation;
        nv.scene.volScale = lastStateBeforeReset.scale;
      }
      updatePlane();
      lastStateBeforeReset = null;
      return;
    }

    // 1st Click: Save current state & perform reset
    lastStateBeforeReset = {
      slider: slider ? slider.value : 0,
      pitch: pitchSlider ? pitchSlider.value : 0,
      yaw: yawSlider ? yawSlider.value : 0,
      roll: rollSlider ? rollSlider.value : 0,
      thresh: threshSlider ? threshSlider.value : 50,
      azimuth: nv.scene ? nv.scene.renderAzimuth : 0,
      elevation: nv.scene ? nv.scene.renderElevation : 0,
      scale: nv.scene ? nv.scene.volScale : 1.0
    };
    btnReset.classList.add("active");

    if (slider) slider.value = 0;
    if (pitchSlider) pitchSlider.value = 0;
    if (yawSlider) yawSlider.value = 0;
    if (rollSlider) rollSlider.value = 0;
    if (threshSlider) threshSlider.value = 50;
    updatePlane();

    if (nv.volumes.length) {
      if (typeof nv.resetScene === 'function') {
        nv.resetScene();
      } else {
        if (nv.scene) {
          nv.scene.renderAzimuth = 0;
          nv.scene.renderElevation = 0;
          nv.scene.volScale = 1.0;
        }
        nv.drawScene();
      }
    }
  });
}

// Fullscreen Button (1st click ENTER, 2nd click UNDO/EXIT)
const btnFullscreen = document.getElementById('btn-fullscreen');
if (btnFullscreen) {
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });
}

// WASM DICOM (dcm2niix) Converter Loader Initialization
const DCM2NIIX_URL = new URL("./vendor/dcm2niix/index.js", location.href).href;
let dicomLoaderPromise = null;

async function initDcm2niix() {
  if (location.protocol === "file:") {
    throw new Error(
      "DICOM conversion needs the page to be served over http. " +
      "Double-click start-viewer.bat (or run `node serve.js`) and open http://localhost:8000/ instead of opening the file directly."
    );
  }
  const { Dcm2niix } = await import(DCM2NIIX_URL);
  const dcm2niix = new Dcm2niix();
  await dcm2niix.init();
  return dcm2niix;
}

function getDicomLoader() {
  if (!dicomLoaderPromise) {
    dicomLoaderPromise = initDcm2niix()
      .then(dcm2niix => async (files) => {
        const out = await dcm2niix.input(files).run();
        const nii = out.filter(f => /\.nii(\.gz)?$/i.test(f.name));
        return Promise.all(nii.map(async f => ({ name: f.name, data: await f.arrayBuffer() })));
      })
      .catch(err => { dicomLoaderPromise = null; throw err; });
  }
  return dicomLoaderPromise;
}

function replaceVolumes() {
  [...nv.volumes].forEach(v => v && nv.removeVolume(v));
}

const isDicom = f => /\.(dcm|dicom)$/i.test(f.name);

// File Upload Handler Supporting Single .nii, Multi-file DICOM slice stacks, or WASM Conversion
if (filePick) {
  filePick.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const fileCountMsg = files.length > 1 
      ? `Stacking ${files.length} DICOM slices into 3D volume...` 
      : `Reading ${files[0].name}...`;
    showLoader(fileCountMsg);

    try {
      if (files.length === 1 && !isDicom(files[0])) {
        // Single NIfTI volume file (.nii / .nii.gz)
        replaceVolumes();
        await nv.loadFromFile(files[0]);
        if (sliceCounter) sliceCounter.textContent = files[0].name;
      } else {
        // Multi-file DICOM stack or single DICOM
        try {
          replaceVolumes();
          await nv.loadFromFileList(files);
          if (sliceCounter) sliceCounter.textContent = `${files.length} DICOM Slices`;
        } catch (listErr) {
          console.warn("Direct loadFromFileList failed, trying dcm2niix WASM fallback:", listErr);
          showLoader("Converting DICOM files to 3D NIfTI volume...");
          const dicomLoader = await getDicomLoader();
          const converted = await dicomLoader(files.filter(isDicom));
          if (!converted.length) throw new Error("No 3D volume could be built from the DICOM file(s)");
          replaceVolumes();
          await nv.loadFromArrayBuffer(converted[0].data, converted[0].name);
          if (sliceCounter) sliceCounter.textContent = `${files.length} DICOM Slices (WASM)`;
        }
      }
      nv.setSliceType(nv.sliceTypeRender);
      
      // Present whole 3D volume on file load
      if (slider) slider.value = 0;
      nv.setClipPlane([0, 0, 0, 0]);

      if (tissuePreset) applyTissuePreset(tissuePreset.value);
      updatePlane();
    } catch (err) {
      console.error("Error assembling 3D scan:", err);
      alert("Error assembling 3D scan. Ensure you selected either a complete .nii/.nii.gz file or all .dcm slices together.");
    } finally {
      hideLoader();
      filePick.value = "";
    }
  });
}

// Window Resize Listener
window.addEventListener("resize", () => nv.resizeListener());
