// ==UserScript==
// @name         MAX_Activation_AdobeGraph
// @namespace    http://tampermonkey.net/
// @author       Luke Vanderberg
// @description  Loads the kiosk cutout, adds Next, and hides edit-access/save-copy notices
// @version      3.1
// @match        https://firefly.adobe.com/graph/*
// @match        https://graph.adobe.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      ffservices24.blob.core.windows.net
// @connect      kiosk-preview--glam-kiosk-site--lukevan.aem.page
// @connect      main--glam-kiosk-site--lukevan.aem.live
// @updateURL    https://main--glam-kiosk-site--lukevan.aem.live/tools/graph-auto-load.user.js
// @downloadURL  https://main--glam-kiosk-site--lukevan.aem.live/tools/graph-auto-load.user.js
// ==/UserScript==

// Captured before the handoff below clears it, so Open Graph can reuse the same portrait.
const maxLaunchHash = location.hash;

(async () => {
  "use strict";

  const uploadControlLabel = "upload new";
  const autoRun = false;

  // Capture before the Graph app can replace its URL. Preserve unrelated hash parameters.
  const capsuleFrame = location.origin === "https://graph.adobe.com";
  if (capsuleFrame && window === window.top) return;
  const params = capsuleFrame ? await new Promise(resolve => {
    let timer;
    const stop = setTimeout(() => {
      clearInterval(timer);
      window.removeEventListener("message", receive);
      console.error("[autoload] No trusted capsule handoff received. Reopen Graph from the kiosk.");
      resolve(null);
    }, 60000);
    function receive(event) {
      if (event.source !== window.top || event.origin !== "https://firefly.adobe.com" ||
          event.data?.type !== "MAX_GRAPH_HANDOFF" ||
          typeof event.data.parameters !== "string") return;
      clearTimeout(stop);
      clearInterval(timer);
      window.removeEventListener("message", receive);
      resolve(new URLSearchParams(event.data.parameters));
    }
    window.addEventListener("message", receive);
    const ready = () => window.top.postMessage({ type: "MAX_GRAPH_FRAME_READY" }, "https://firefly.adobe.com");
    timer = setInterval(ready, 400);
    ready();
  }) : new URLSearchParams(location.hash.slice(1));
  if (!params) return;
  const supplied = params.getAll("portraitUrl");
  const publicMetadata = params.getAll("publicDemo");
  if (!supplied.length) return;
  params.delete("portraitUrl");
  params.delete("publicDemo");
  const remaining = params.toString();
  try {
    if (!capsuleFrame) {
      history.replaceState(
        history.state, "",
        location.pathname + location.search + (remaining ? `#${remaining}` : "")
      );
    }
  } catch {
    console.error("[autoload] Could not clear portrait handoff from address bar.");
    return;
  }

  const log = message => {
    console.log("[autoload]", message);
  };

  function invalid(code, message) {
    const error = new Error(message);
    error.handoffCode = code;
    return error;
  }

  function validateUrl(value) {
    let url;
    try { url = new URL(value); } catch {
      throw invalid("url_invalid", "Invalid portrait URL.");
    }
    if (url.origin !== "https://ffservices24.blob.core.windows.net" ||
        url.username || url.password || url.hash) throw invalid("host_invalid", "Invalid portrait host.");
    let path;
    try { path = decodeURIComponent(url.pathname); } catch {
      throw invalid("path_invalid", "Invalid cutout path.");
    }
    if (!/^\/meow-ffs-storage-corex\/(?:[^/]+\/)+9-Graph-Input\/azure_[0-9a-f]{64}\/portrait\.png$/.test(path) ||
        path.split("/").some(part => part === "." || part === "..") ||
        /[\\\u0000-\u001f\u007f]/.test(path)) throw invalid("path_invalid", "Invalid cutout path.");
    const allowed = new Set(["sv", "sig", "st", "se", "sp", "spr", "sr"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
        throw invalid("parameters_invalid", "Invalid image access parameters.");
      }
    }
    if (url.searchParams.get("sp") !== "r" ||
        url.searchParams.get("sr") !== "b" ||
        url.searchParams.get("spr") !== "https" ||
        !url.searchParams.get("sig") || !url.searchParams.get("sv")) {
      throw invalid("permissions_invalid", "Expected image-only, read-only access.");
    }
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/;
    const start = url.searchParams.get("st");
    const end = url.searchParams.get("se");
    const now = Date.now();
    const expiry = Date.parse(end);
    const starts = Date.parse(start);
    if (!utc.test(start || "") || !utc.test(end || "") ||
        !Number.isFinite(starts) || !Number.isFinite(expiry)) {
      throw invalid("timestamp_invalid", "Portrait access requires valid UTC timestamps.");
    }
    if (starts > now) throw invalid("not_active", "Portrait access is not active yet.");
    if (expiry <= now) throw invalid("expired", "Portrait access has expired.");
    if (expiry - now > 7 * 24 * 60 * 60 * 1000) {
      throw invalid("expiry_too_long", "Portrait access exceeds the seven-day limit.");
    }
    return url.href;
  }

  let imageUrl;
  let publicDemo;
  function validatePublicUrl(value, metadata) {
    const origins = [
      "https://kiosk-preview--glam-kiosk-site--lukevan.aem.page",
      "https://main--glam-kiosk-site--lukevan.aem.live",
    ];
    if (!metadata || !/^demo_[A-Za-z0-9_-]{1,115}$/.test(metadata.personId) ||
        !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(metadata.templateSetId) ||
        !/^[a-f0-9]{32}$/.test(metadata.version) ||
        !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
        !["1-larocheposay", "2-lorealprofessionnel", "3-YSLbeauty", "4-lorealparis"].includes(metadata.brand)) {
      throw invalid("public_provenance_invalid", "Invalid public demo provenance.");
    }
    let url;
    try { url = new URL(value); } catch {
      throw invalid("public_url_invalid", "Invalid public demo URL.");
    }
    const path = `/assets/permanent-demo-cutouts/${metadata.personId}/${metadata.templateSetId}/${metadata.version}/${metadata.brand}.png`;
    if (!origins.includes(url.origin) || value !== `${url.origin}${path}`) {
      throw invalid("public_url_invalid", "Invalid public demo URL.");
    }
    return url.href;
  }
  try {
    if (supplied.length !== 1) throw invalid("duplicate_handoff", "Duplicate portrait handoff.");
    if (publicMetadata.length) {
      if (publicMetadata.length !== 1) throw invalid("public_provenance_invalid", "Duplicate public demo provenance.");
      try { publicDemo = JSON.parse(publicMetadata[0]); } catch {
        throw invalid("public_provenance_invalid", "Invalid public demo provenance.");
      }
      imageUrl = validatePublicUrl(supplied[0], publicDemo);
    } else imageUrl = validateUrl(supplied[0]);
  } catch (error) {
    // Do not print URL parser errors: those can include the SAS.
    log(`Portrait handoff rejected (${error.handoffCode || "handoff_invalid"}). Return to the kiosk for a fresh link.`);
    return;
  }

  if (!capsuleFrame && location.pathname.startsWith("/graph/capsule/")) {
    const parameters = new URLSearchParams({ portraitUrl: supplied[0] });
    if (publicDemo) parameters.set("publicDemo", JSON.stringify(publicDemo));
    log("Waiting for the trusted graph.adobe.com capsule frame.");
    const timeout = setTimeout(() => {
      window.removeEventListener("message", relay);
      log("Capsule frame handoff timed out. Enable this userscript on graph.adobe.com and reopen Graph.");
    }, 60000);
    function relay(event) {
      if (event.origin !== "https://graph.adobe.com" ||
          event.data?.type !== "MAX_GRAPH_FRAME_READY" ||
          ![...walk(document)].some(element =>
            element.localName === "iframe" && element.contentWindow === event.source)) return;
      event.source.postMessage({ type: "MAX_GRAPH_HANDOFF", parameters: parameters.toString() },
        "https://graph.adobe.com");
      window.removeEventListener("message", relay);
      clearTimeout(timeout);
      log("Portrait handoff sent to the trusted capsule frame.");
    }
    window.addEventListener("message", relay);
    return;
  }

  function fetchFile() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: imageUrl,
        responseType: "blob",
        timeout: 60000,
        anonymous: true,
        onload: async response => {
          try {
            if (response.status < 200 || response.status >= 300) {
              throw new Error("Portrait download failed.");
            }
            if (response.finalUrl) {
              if (publicDemo) validatePublicUrl(response.finalUrl, publicDemo);
              else validateUrl(response.finalUrl);
            }
            const blob = response.response;
            if (!(blob instanceof Blob) || blob.type.toLowerCase() !== "image/png" ||
                !blob.size || blob.size > 20 * 1024 * 1024) {
              throw new Error("Expected a PNG portrait, at most 20 MiB.");
            }
            const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
            if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte)) {
              throw new Error("Invalid PNG portrait.");
            }
            if (publicDemo) {
              const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
              const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
              if (sha256 !== publicDemo.sha256) throw new Error("Public demo cutout checksum mismatch.");
            }
            // Graph's uploader may check against its own window.File.
            // A userscript-sandbox File can fail that check despite valid bytes.
            const bytes = new unsafeWindow.Uint8Array(await blob.arrayBuffer());
            resolve(new unsafeWindow.File([bytes], "portrait.png", { type: "image/png" }));
          } catch {
            reject(new Error("Portrait download was not a valid PNG."));
          }
        },
        onerror: () => reject(new Error("Portrait download failed.")),
        ontimeout: () => reject(new Error("Portrait download timed out.")),
        onabort: () => reject(new Error("Portrait download cancelled.")),
      });
    });
  }

  function* walk(root) {
    if (root.shadowRoot) yield* walk(root.shadowRoot);
    for (const el of root.querySelectorAll("*")) {
      yield el;
      if (el.shadowRoot) yield* walk(el.shadowRoot);
      if (el.localName === "iframe") {
        // Cross-origin frame documents are intentionally inaccessible.
        const doc = el.contentDocument;
        if (doc && el.getBoundingClientRect().width > 0 &&
            el.getBoundingClientRect().height > 0) yield* walk(doc);
      }
    }
  }
  function* findAllByText(text, root = document) {
    const normalize = value => (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const expected = normalize(text);
    for (const el of walk(root)) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
      const editableTitle = (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
        && normalize(el.value) === expected;
      const exactText = normalize(el.textContent) === expected;
      if (editableTitle || (exactText && ![...el.children].some(
        child => normalize(child.textContent) === expected
      ))) yield el;
    }
  }
  const findByText = (text, root = document) => findAllByText(text, root).next().value;
  function uploadLabel(element) {
    const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const label = (element.getAttribute("aria-label") || "").trim().toLowerCase();
    return label === "upload new image" ? "upload new" : text;
  }
  function enclosingGraphNode(element) {
    for (let current = element; current;
      current = current.parentElement || current.getRootNode().host) {
      if (current.localName === "pg-node") return current;
    }
    // Capsule view groups the label and uploader without a pg-node wrapper.
    // Use the nearest group containing an upload control, not the whole input/output page.
    for (let current = element; current && current !== element.ownerDocument.body &&
      current !== element.ownerDocument.documentElement;
      current = current.parentElement || current.getRootNode().host) {
      const controls = [...walk(current)].filter(child =>
        child.matches("button, sp-button, [role='button']") &&
        ["upload new", "browse files"].includes(
          uploadLabel(child)
        ));
      if (controls.length) return current;
    }
    throw new Error("Input image upload group was not found.");
  }

  function findUploadArea(node, expectedLabel = uploadControlLabel) {
    const replacements = [...walk(node)].filter(element => {
      if (!element.matches("button, sp-button, [role='button']") ||
          element.disabled || element.getAttribute("aria-disabled") === "true") return false;
      for (let parent = element; parent && parent !== node;
        parent = parent.parentElement || parent.getRootNode().host) {
        if (parent.getAttribute("aria-busy") === "true") return false;
        if (expectedLabel === "browse files" &&
            parent.localName.startsWith("adobe-widget-image-") &&
            [...walk(parent)].some(child => ["img", "video", "canvas"].includes(child.localName))) return false;
      }
      const label = uploadLabel(element);
      const rect = element.getBoundingClientRect();
      return label === expectedLabel && rect.width > 0 && rect.height > 0 &&
        getComputedStyle(element).visibility !== "hidden";
    });
    // Spectrum controls may contain a native button with the same label.
    const controls = replacements.filter(element => !replacements.some(other => {
      if (other === element) return false;
      for (let parent = element.parentElement || element.getRootNode().host; parent;
        parent = parent.parentElement || parent.getRootNode().host) {
        if (parent === other) return true;
      }
      return false;
    }));
    if (controls.length > 1) throw new Error("Input image node has multiple matching upload controls.");
    if (controls.length === 1) return controls[0];
    return null;
  }

  function uploadedImageReady(title) {
    if (!title) return false;
    const node = enclosingGraphNode(title);
    const contents = [...walk(node)];
    return !contents.some(element => element.getAttribute("aria-busy") === "true") &&
      (Boolean(findUploadArea(node, "upload new")) ||
      contents.some(element => element.localName === "img" &&
        element.complete && element.naturalWidth > 0 &&
        element.getBoundingClientRect().width > 0));
  }

  function findRunControl(capsuleView, root) {
    const buttons = [...walk(root)].filter(element => {
      if (!element.matches("button, sp-button, [role='button']")) return false;
      const normalize = value => (value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const text = normalize(element.textContent);
      const label = normalize(element.getAttribute("aria-label"));
      const rect = element.getBoundingClientRect();
      let capsuleControl = false;
      for (let parent = element; parent;
        parent = parent.parentElement || parent.getRootNode().host) {
        if (parent.localName === "capsule-run-controls") capsuleControl = true;
      }
      const matches = capsuleView
        ? capsuleControl && (text === "run" || label === "run")
        : text === "run all" || label === "run all";
      return matches &&
        rect.width > 0 && rect.height > 0 &&
        getComputedStyle(element).visibility !== "hidden";
    });
    const controls = buttons.filter(element => !buttons.some(other => {
      if (other === element) return false;
      for (let parent = element.parentElement || element.getRootNode().host; parent;
        parent = parent.parentElement || parent.getRootNode().host) {
        if (parent === other) return true;
      }
      return false;
    }));
    if (controls.length > 1) throw new Error("Multiple Graph run controls found.");
    const control = controls[0];
    if (!control) return null;
    for (const element of [control, ...walk(control)]) {
      if (element.disabled || element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          element.getAttribute("aria-busy") === "true") return null;
    }
    return control;
  }

  const poll = (fn, ms = 400, timeout = 60000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const id = setInterval(() => {
      try {
        const result = fn();
        if (result) {
          clearInterval(id);
          resolve(result);
        } else if (Date.now() - started > timeout) {
          clearInterval(id);
          reject(new Error("Graph upload control was not found."));
        }
      } catch {
        clearInterval(id);
        reject(new Error("Graph upload control lookup failed."));
      }
    }, ms);
  });
  const clickEl = el => {
    const rect = el.getBoundingClientRect();
    const options = {
      bubbles: true, composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, options));
    }
  };

  // Keep the user's existing shadow-DOM upload sequence. Override the picker
  // only around the final "Your device" click, restoring it after one use.
  (async () => {
    let pickerWindow;
    let originalPicker;
    let fakePicker;
    try {
      log("Downloading kiosk cutout.");
      const file = await fetchFile();
      log("Looking for Input image node.");
      // The label can render before its uploader, so retry title + group together.
      let sawTitle = false;
      let attempts = 0;
      const located = await poll(() => {
        attempts += 1;
        for (const candidate of findAllByText("Input image")) {
          if (!sawTitle) {
            sawTitle = true;
            log("Input image title found. Waiting for its upload area.");
          }
          try {
            return { title: candidate, node: enclosingGraphNode(candidate) };
          } catch {
            // Uploader not rendered yet; keep polling.
          }
        }
        if (attempts % 25 === 0) log("Still waiting for the Input image upload area.");
        return null;
      }, 400, 60000).catch(() => {
        throw new Error(sawTitle
          ? "Input image upload group was not found after 60 seconds."
          : "Input image title was not found. Check that its node is visible and its frame is same-origin.");
      });
      const { title, node } = located;
      const capsuleView = node.localName !== "pg-node";
      // Resolve the page realm through unsafeWindow, including nested capsule frames.
      function pageWindow(root) {
        if (root.document === title.ownerDocument) return root;
        for (const element of walk(root.document)) {
          if (element.localName === "iframe" && element.contentDocument === title.ownerDocument) {
            return element.contentWindow;
          }
        }
        throw new Error("Input image frame is not accessible.");
      }
      pickerWindow = pageWindow(unsafeWindow);
      originalPicker = pickerWindow.showOpenFilePicker;
      const area = await poll(() => findUploadArea(node))
        .catch(() => {
          throw new Error(`Input image node needs one visible ${uploadControlLabel} control.`);
        });
      log("Input image upload area found.");
      let device;
      for (let attempt = 1; attempt <= 3 && !device; attempt++) {
        clickEl(area);
        device = await poll(() => findByText("Your device", title.ownerDocument), 200, 8000)
          .catch(() => null);
        if (!device && attempt < 3) log(`Your device option did not appear; retrying (${attempt}/3).`);
      }
      if (!device) throw new Error("Your device option did not appear after 3 attempts.");
      if (typeof originalPicker !== "function") {
        throw new Error("This browser does not support the Graph file picker.");
      }
      let used = false;
      let fileRead = false;
      fakePicker = async function (options) {
        if (used) return originalPicker.call(pickerWindow, options);
        used = true;
        if (pickerWindow.showOpenFilePicker === fakePicker) {
          pickerWindow.showOpenFilePicker = originalPicker;
        }
        const handle = {
          kind: "file", name: file.name,
          getFile: async () => {
            fileRead = true;
            const bytes = new pickerWindow.Uint8Array(await file.arrayBuffer());
            return new pickerWindow.File([bytes], file.name, { type: file.type });
          },
          isSameEntry: async other => other === handle,
          queryPermission: async () => "granted",
          requestPermission: async () => "granted",
        };
        log("Portrait supplied to Graph file picker.");
        return [handle];
      };
      pickerWindow.showOpenFilePicker = fakePicker;
      clickEl(device);
      await poll(() => used, 100, 10000);
      if (autoRun || capsuleView) {
        const runLabel = capsuleView ? "Run" : "Run all";
        log("Waiting for Input image upload to finish.");
        await poll(() => fileRead && uploadedImageReady(title), 200, 60000).catch(() => {
          throw new Error(`Input image upload was not confirmed; ${runLabel} was not clicked.`);
        });
        log(`Input image upload confirmed. Looking for ${runLabel}.`);
        const run = await poll(() => findRunControl(capsuleView, title.ownerDocument), 200, 60000).catch(() => {
          throw new Error(`One enabled ${runLabel} control was not found; processing was not started.`);
        });
        // Recheck after waiting for the toolbar; never run on a stale upload state.
        if (!uploadedImageReady(title)) throw new Error("Input image is no longer ready; processing was not started.");
        clickEl(run);
        log(`${runLabel} clicked.`);
      }
    } catch (error) {
      log(error.message);
    } finally {
      if (fakePicker && pickerWindow.showOpenFilePicker === fakePicker) {
        pickerWindow.showOpenFilePicker = originalPicker;
      }
    }
  })();
})();

  (() => {
    "use strict";
    if (location.origin === "https://graph.adobe.com") return;

    // Give Graph time to load before offering Next.
    const NEXT_DELAY_MS = 5000;
    const OLD_GRAPH_PATH = "/graph/edit/id/urn:aaid:sc:US:08944592-9145-526f-8b43-75400178e5ee";
    const nextReadyAt = Date.now() + NEXT_DELAY_MS;
    function addButton() {
      if (Date.now() < nextReadyAt) return;
      if (!document.body || document.getElementById("max-see-ads-btn")) return;
      const button = document.createElement("button");
      button.id = "max-see-ads-btn";
      button.type = "button";
      button.textContent = "Scale Your Ads";
      Object.assign(button.style, {
        position: "fixed", bottom: "32px", right: "32px", zIndex: "999999",
        padding: "0 28px", minWidth: "168px", minHeight: "64px", background: "#1473E6", color: "#fff",
        border: "none", borderRadius: "32px", fontSize: "24px", fontWeight: "700",
        fontFamily: 'adobe-clean, "Source Sans Pro", sans-serif', cursor: "pointer",
        boxShadow: "0 4px 20px rgba(0,0,0,0.28)",
        transition: "background 0.15s, transform 0.1s",
      });
      button.addEventListener("mouseenter", () => { button.style.background = "#0d66d0"; });
      button.addEventListener("mouseleave", () => {
        button.style.background = "#1473E6";
        button.style.transform = "scale(1)";
      });
      button.addEventListener("mousedown", () => { button.style.transform = "scale(0.97)"; });
      button.addEventListener("mouseup", () => { button.style.transform = "scale(1)"; });
      button.addEventListener("click", () => {
        // Only a fixed completion message crosses origins; never include the SAS.
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: "ADOBE_GRAPH_DONE" }, "*");
        }
        window.close();
      });
      document.body.appendChild(button);
      if (location.pathname !== OLD_GRAPH_PATH) addOpenGraphButton(button);
    }

    function addOpenGraphButton(nextButton) {
      if (document.getElementById("max-open-graph-btn")) return;
      const button = document.createElement("button");
      button.id = "max-open-graph-btn";
      button.type = "button";
      button.textContent = "Open Graph";
      Object.assign(button.style, {
        position: "fixed", bottom: "32px", zIndex: "999999",
        right: `${32 + nextButton.offsetWidth + 16}px`,
        padding: "0 28px", minWidth: "168px", minHeight: "64px", background: "#fff", color: "#1473E6",
        border: "2px solid #1473E6", borderRadius: "32px", fontSize: "24px", fontWeight: "700",
        fontFamily: 'adobe-clean, "Source Sans Pro", sans-serif', cursor: "pointer",
        boxShadow: "0 4px 20px rgba(0,0,0,0.28)",
      });
      button.addEventListener("click", () => {
        window.open(`https://firefly.adobe.com${OLD_GRAPH_PATH}${maxLaunchHash}`, "_blank", "noopener");
      });
      document.body.appendChild(button);
    }

    const observedRoots = new WeakSet();
    function hideEditAccessDialog() {
      if (!document.body) return;
      function scan(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          const accessNotice = /\b(?:do not|don['’]t) have edit access\b/.test(text);
          const saveCopy = /\bsave a copy\b/.test(text);
          if (!accessNotice && !saveCopy) continue;
          for (let element = node.parentElement, depth = 0; element && depth < 16;
            element = element.parentElement || element.getRootNode().host, depth++) {
            if (element === document.body || element === document.documentElement) break;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const role = (element.getAttribute("role") || "").toLowerCase();
            const notice = ["dialog", "alertdialog", "alert", "status"].includes(role) ||
              ["dialog", "sp-dialog", "sp-alert-dialog", "sp-toast"].includes(element.localName);
            const noticeSized = rect.width > 0 && rect.width <= 900 &&
              rect.height > 0 && rect.height <= 650;
            const floating = style.position === "fixed" || style.position === "absolute";
            if (noticeSized && (notice || (accessNotice && floating))) {
              // Close native modal dialogs to release their backdrop/focus trap.
              if (element.localName === "dialog" && element.open) element.close();
              element.style.setProperty("display", "none", "important");
              break;
            }
          }
        }
        for (const element of root.querySelectorAll("*")) {
          if (!element.shadowRoot) continue;
          if (!observedRoots.has(element.shadowRoot)) {
            observedRoots.add(element.shadowRoot);
            new MutationObserver(refresh).observe(element.shadowRoot, {
              childList: true, subtree: true, characterData: true,
              attributes: true, attributeFilter: ["open", "role", "class", "hidden"],
            });
          }
          scan(element.shadowRoot);
        }
      }
      scan(document.body);
    }

    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        addButton();
        hideEditAccessDialog();
      }, 100);
    };

    // Watch document rather than body: body may not exist at document-start,
    // and watching it alone would miss replacement during an SPA remount.
    new MutationObserver(refresh).observe(document, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["open", "role", "class", "hidden"],
    });
    window.addEventListener("popstate", refresh);
    addButton();
    for (const delay of [300, 800, 1500, NEXT_DELAY_MS + 50]) setTimeout(refresh, delay);
  })();
