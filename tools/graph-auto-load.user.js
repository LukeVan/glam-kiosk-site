// ==UserScript==
// @name         MAX_Activation_AdobeGraph
// @namespace    http://tampermonkey.net/
// @author       Luke Vanderberg
// @description  Loads the kiosk cutout, adds See your Ads, and hides edit-access/save-copy notices
// @version      2.1
// @match        https://firefly.adobe.com/graph/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      ffservices24.blob.core.windows.net
// @connect      kiosk-preview--glam-kiosk-site--lukevan.aem.page
// @connect      main--glam-kiosk-site--lukevan.aem.live
// ==/UserScript==

(() => {
  "use strict";

  // Capture before the Graph app can replace its URL. Preserve unrelated hash parameters.
  const params = new URLSearchParams(location.hash.slice(1));
  const supplied = params.getAll("portraitUrl");
  const publicMetadata = params.getAll("publicDemo");
  if (!supplied.length) return;
  params.delete("portraitUrl");
  params.delete("publicDemo");
  const remaining = params.toString();
  try {
    history.replaceState(
      history.state, "",
      location.pathname + location.search + (remaining ? `#${remaining}` : "")
    );
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
    }
  }
  const findByText = text => {
    const normalize = value => (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const expected = normalize(text);
    for (const el of walk(document)) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
      const editableTitle = (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
        && normalize(el.value) === expected;
      const exactText = normalize(el.textContent) === expected;
      if (editableTitle || (exactText && ![...el.children].some(
        child => normalize(child.textContent) === expected
      ))) return el;
    }
  };
  function enclosingGraphNode(element) {
    for (let current = element; current;
      current = current.parentElement || current.getRootNode().host) {
      if (current.localName === "pg-node") return current;
    }
    throw new Error("Input image title is not inside a Graph node.");
  }

  function findUploadArea(node) {
    const areas = [];
    for (const element of walk(node)) {
      if (!element.localName.startsWith("adobe-widget-image-") || !element.shadowRoot) continue;
      for (const area of element.shadowRoot.querySelectorAll(".dropzone")) {
        const visible = candidate => {
          if (!candidate) return false;
          const rect = candidate.getBoundingClientRect();
          const style = getComputedStyle(candidate);
          return rect.width > 0 && rect.height > 0 &&
            style.visibility !== "hidden" && style.display !== "none";
        };
        if (!visible(area) || area.getAttribute("aria-busy") === "true" ||
            [...walk(element)].some(candidate => ["img", "video", "canvas"].includes(candidate.localName))) continue;
        const prompt = area.querySelector(".prompt");
        const browse = area.querySelector("sp-button.browse-button");
        const emptyPrompt = area.getAttribute("aria-busy") === "false" &&
          visible(prompt) && visible(prompt.querySelector(".placeholder-icon")) &&
          visible(prompt.querySelector(".prompt-title")) &&
          visible(prompt.querySelector(".prompt-subtitle")) && visible(browse);
        if (area.classList.contains("empty") || emptyPrompt) areas.push(area);
      }
    }
    if (areas.length > 1) throw new Error("Input image node has multiple upload areas.");
    return areas[0];
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
    const originalPicker = unsafeWindow.showOpenFilePicker;
    let fakePicker;
    try {
      log("Downloading kiosk cutout.");
      const file = await fetchFile();
      log("Looking for Input image node.");
      let title;
      try {
        title = await poll(() => findByText("Input image"));
      } catch {
        throw new Error("Input image title was not found. Check that its node is visible.");
      }
      log("Input image title found. Looking for its upload area.");
      const node = enclosingGraphNode(title);
      const area = await poll(() => findUploadArea(node))
        .catch(() => {
          throw new Error("Input image node needs one visible, empty image dropzone.");
        });
      log("Input image upload area found.");
      clickEl(area);
      const device = await poll(() => findByText("Your device"));
      if (typeof originalPicker !== "function") {
        throw new Error("This browser does not support the Graph file picker.");
      }
      let used = false;
      fakePicker = async function (options) {
        if (used) return originalPicker.call(unsafeWindow, options);
        used = true;
        if (unsafeWindow.showOpenFilePicker === fakePicker) {
          unsafeWindow.showOpenFilePicker = originalPicker;
        }
        const handle = {
          kind: "file", name: file.name,
          getFile: async () => file,
          isSameEntry: async other => other === handle,
          queryPermission: async () => "granted",
          requestPermission: async () => "granted",
        };
        log("Portrait supplied to Graph file picker.");
        return [handle];
      };
      unsafeWindow.showOpenFilePicker = fakePicker;
      clickEl(device);
      await poll(() => used, 100, 10000);
    } catch (error) {
      log(error.message);
    } finally {
      if (fakePicker && unsafeWindow.showOpenFilePicker === fakePicker) {
        unsafeWindow.showOpenFilePicker = originalPicker;
      }
    }
  })();
})();

  (() => {
    "use strict";

    function addButton() {
      if (!document.body || document.getElementById("max-see-ads-btn")) return;
      const button = document.createElement("button");
      button.id = "max-see-ads-btn";
      button.type = "button";
      button.textContent = "See your Ads";
      Object.assign(button.style, {
        position: "fixed", bottom: "32px", right: "32px", zIndex: "999999",
        padding: "14px 28px", background: "#1473E6", color: "#fff",
        border: "none", borderRadius: "24px", fontSize: "16px", fontWeight: "700",
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
    for (const delay of [300, 800, 1500]) setTimeout(refresh, delay);
  })();
