const TOPBAR_HOST_SELECTORS = [
    ".comfyui-header-actions",
    ".comfyui-header-right",
    ".comfy-menu-btns",
    ".comfyui-menu",
    ".comfy-menu",
    ".comfyui-toolbar",
    "#comfyui-body-top",
    ".comfyui-body-top",
    "#comfy-menu",
    ".comfyui-header-left",
    ".comfyui-header",
    ".litegraph-menu",
    "header",
    ".comfyui-menu-push",
];

const TOPBAR_STYLE_ID = "dd-translation-topbar-style";
const TOPBAR_ROOT_CLASS = "dd-translation-topbar";
const TOPBAR_ROOT_SELECTOR = `.${TOPBAR_ROOT_CLASS}`;
const TOPBAR_BUTTON_CLASS = "dd-translation-topbar__button";
const TOPBAR_LABEL_CLASS = "dd-translation-topbar__label";

function isElementActuallyVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle?.(element);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect) return false;
    return rect.width > 0 && rect.height > 0;
}

function getPreferredTopbarHost() {
    for (const selector of TOPBAR_HOST_SELECTORS) {
        const host = document.querySelector(selector);
        if (host && isElementActuallyVisible(host)) {
            return host;
        }
    }
    for (const selector of TOPBAR_HOST_SELECTORS) {
        const host = document.querySelector(selector);
        if (host) {
            return host;
        }
    }
    return null;
}

function getPreferredTopbarMountContainer(host) {
    if (!host) return null;
    const innerSelectors = [
        ".comfyui-header-actions",
        ".comfyui-header-right",
        ".comfy-menu-btns",
        ".comfyui-menu",
        ".comfy-menu",
        ".comfyui-menu-push",
    ];
    for (const selector of innerSelectors) {
        const inner = host.matches?.(selector) ? host : host.querySelector?.(selector);
        if (inner && isElementActuallyVisible(inner)) {
            return inner;
        }
    }
    return host;
}

function getAppMenuAnchor(deps = {}) {
    const appMenu = deps.app?.menu;
    if (appMenu?.actionsGroup?.element) {
        return appMenu.actionsGroup.element;
    }
    if (appMenu?.settingsGroup?.element) {
        return appMenu.settingsGroup.element;
    }
    return null;
}

function ensureTopbarStyles() {
    if (document.getElementById(TOPBAR_STYLE_ID)) return;
    
    const style = document.createElement("style");
    style.id = TOPBAR_STYLE_ID;
    style.textContent = `
.${TOPBAR_ROOT_CLASS} {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    min-width: 0;
    margin-left: 0;
    margin-right: 4px;
}
.${TOPBAR_BUTTON_CLASS} {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    height: 36px;
    min-height: 36px;
    padding: 0 14px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(90deg, #0088cc 0%, #0048d9ff 100%);
    color: #ffffff;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    flex: 0 0 auto;
    overflow: hidden;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease, filter 0.18s ease;
}
.${TOPBAR_BUTTON_CLASS}:hover {
    box-shadow: none;
    filter: brightness(1.14) saturate(1.10);
}
.${TOPBAR_BUTTON_CLASS}:focus-visible {
    outline: none;
}
.${TOPBAR_BUTTON_CLASS}[data-enabled="true"] {
    background: linear-gradient(90deg,  #0048d9 100%);
    color: #ffffff;
}
.${TOPBAR_BUTTON_CLASS}[data-enabled="true"]:hover {
    background: linear-gradient(90deg, #0048d9 100%);
    box-shadow: none;
}
.${TOPBAR_BUTTON_CLASS}[data-enabled="false"] {
    background: linear-gradient(90deg,  #333333 100%);
    color: rgba(255, 255, 255, 0.92);
}
.${TOPBAR_BUTTON_CLASS}[data-pending="true"] {
    cursor: wait;
    opacity: 0.75;
}
.${TOPBAR_LABEL_CLASS} {
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
}
@media (max-width: 960px) {
    .${TOPBAR_ROOT_CLASS} {
        margin-left: 0;
        margin-right: 3px;
    }
    .${TOPBAR_BUTTON_CLASS} {
        gap: 0;
        height: 34px;
        min-height: 34px;
        padding: 0 12px;
        font-size: 12px;
    }
}
@media (max-width: 720px) {
    .${TOPBAR_BUTTON_CLASS} {
        padding: 0 10px;
    }
    .${TOPBAR_LABEL_CLASS} {
        max-width: 96px;
    }
}
`;
    document.head?.appendChild(style);
}

function createButton(deps) {
    const root = document.createElement("div");
    root.className = TOPBAR_ROOT_CLASS;
    root.dataset.ddTranslationTopbar = "true";
    root.dataset.pending = "false";
    root._dd_deps = deps;

    const button = document.createElement("button");
    button.type = "button";
    button.className = TOPBAR_BUTTON_CLASS;

    const label = document.createElement("span");
    label.className = TOPBAR_LABEL_CLASS;

    button.append(label);
    root.appendChild(button);

    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (root.dataset.pending === "true") {
            return;
        }

        root.dataset.pending = "true";
        updateButtonState(root);

        try {
            const result = await deps.toggleTranslation?.();
            if (result === false) {
                root.dataset.pending = "false";
                updateButtonState(root);
            }
        } catch (e) {
            root.dataset.pending = "false";
            updateButtonState(root);
            deps.error?.("顶部栏翻译开关切换失败:", e);
        }
    });

    return root;
}

function updateButtonState(root) {
    if (!root) return;
    const deps = root._dd_deps || {};
    const button = root.querySelector(`.${TOPBAR_BUTTON_CLASS}`);
    const label = root.querySelector(`.${TOPBAR_LABEL_CLASS}`);
    if (!button || !label) return;

    const enabled = !!deps.isTranslationEnabled?.();
    const pending = root.dataset.pending === "true" || window._dd_toggling === true;

    root.dataset.enabled = String(enabled);
    button.dataset.enabled = String(enabled);
    button.dataset.pending = String(pending);
    button.setAttribute("aria-pressed", String(enabled));

    label.textContent = pending 
        ? "翻译切换中" 
        : `${enabled ? "中文" : "英文"}`;
    
    button.title = pending 
        ? "正在切换翻译状态，请稍候..." 
        : `当前翻译${enabled ? "中文" : "英文"}，点击后将切换状态并自动刷新页面`;
}

function mountButton(root) {
    if (!root) return false;

    const deps = root._dd_deps || {};
    const appMenuAnchor = getAppMenuAnchor(deps);
    if (appMenuAnchor?.before) {
        appMenuAnchor.before(root);
        return true;
    }

    const host = getPreferredTopbarHost();
    if (!host) {
        window.console?.warn?.("[DD-Translation] 未找到顶部栏容器，当前按钮暂未挂载");
        return false;
    }

    const mountContainer = getPreferredTopbarMountContainer(host);
    if (!mountContainer) return false;

    if (root.parentElement !== mountContainer) {
        mountContainer.appendChild(root);
    }

    return true;
}

// 高性能版本：只执行一次，只创建一个按钮
export function installTopbarButton(deps = {}) {
    try {
        // 1. 如果已经创建过按钮，直接返回
        if (window._dd_topbar_button_created) {
            return;
        }
        
        ensureTopbarStyles();
        
        // 2. 删除所有已存在的按钮
        const existingButtons = document.querySelectorAll(TOPBAR_ROOT_SELECTOR);
        existingButtons.forEach(btn => {
            try {
                btn.remove();
            } catch(e) {}
        });
        
        // 3. 创建一个新按钮
        const button = createButton(deps);
        updateButtonState(button);
        mountButton(button);
        
        // 4. 标记为已创建
        window._dd_topbar_button_created = true;
        
        // 5. 页面加载完成后检查一次（仅一次）
        const finalCheck = () => {
            // 检查是否有多个按钮
            const buttons = document.querySelectorAll(TOPBAR_ROOT_SELECTOR);
            if (buttons.length > 1) {
                // 保留第一个，删除其他
                for (let i = 1; i < buttons.length; i++) {
                    try {
                        buttons[i].remove();
                    } catch(e) {}
                }
            }
        };
        
        // 页面完全加载后执行一次检查
        window.addEventListener("load", finalCheck, { once: true });
        
    } catch (e) {
        deps.error?.("顶部栏按钮安装失败:", e);
    }
}

// 以下是状态栏翻译功能，保持原样
function scheduleTopbarStatusAttach() {
    if (window._dd_topbar_status_attach_raf) return;
    window._dd_topbar_status_attach_raf = window.requestAnimationFrame(() => {
        window._dd_topbar_status_attach_raf = 0;
        window._dd_topbar_status_attach?.();
    });
}

function uniqueElements(elements) {
    const seen = new Set();
    return elements.filter((element) => {
        if (!element || seen.has(element)) return false;
        seen.add(element);
        return true;
    });
}

function getTopbarRoots() {
    const roots = uniqueElements(
        TOPBAR_HOST_SELECTORS
            .map((selector) => document.querySelector(selector))
            .filter(Boolean)
    );
    if (roots.length) {
        return roots.filter((root) => isElementActuallyVisible(root));
    }
    return [];
}

function ensureTopbarStatusBootstrapObserver() {
    if (window._dd_topbar_status_bootstrap_observer || !document.body) return;
    
    const TOPBAR_SCOPE_SELECTOR = TOPBAR_HOST_SELECTORS.join(", ");
    
    function isNodeInTopbarScope(node) {
        try {
            const element = node?.nodeType === Node.ELEMENT_NODE
                ? node
                : node?.nodeType === Node.TEXT_NODE
                    ? node.parentElement
                    : null;
            return !!element?.closest?.(TOPBAR_SCOPE_SELECTOR);
        } catch (e) {
            return false;
        }
    }

    window._dd_topbar_status_bootstrap_observer = new MutationObserver((mutationsList) => {
        const isTopbarMutation = (mutationsList || []).some((mutation) => {
            if (isNodeInTopbarScope(mutation.target)) return true;
            const addedNodes = Array.from(mutation.addedNodes || []);
            return addedNodes.some((node) => isNodeInTopbarScope(node));
        });

        if (isTopbarMutation) {
            scheduleTopbarStatusAttach();
        }
    });

    window._dd_topbar_status_bootstrap_observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

export function installTopbarStatusTranslation(deps = {}) {
    const { TUtils, isTranslationEnabled, error } = deps;

    try {
        if (!isTranslationEnabled?.()) return;

        const menuT = TUtils?.T?.Menu || {};
        const statusTerms = [
            "Idle",
            "Running",
            "Queue",
            "Queued",
            "Pending",
            "Processing",
            "Stopping",
            "Stopped",
            "Error",
        ];
        const statusTermMap = new Map(
            statusTerms.map((term) => [term.toLowerCase(), term])
        );

        const getStatusTranslation = (text) => {
            if (typeof text !== "string") return null;
            const trimmed = text.replace(/\s+/g, " ").trim();
            if (!trimmed) return null;
            const canonical = statusTermMap.get(trimmed.toLowerCase());
            if (!canonical) return null;
            const translated = TUtils.getTranslationFromMap(menuT, canonical, false);
            if (!translated || translated === trimmed) return null;
            return translated;
        };

        const shouldSkipElement = (element) => {
            if (!element) return true;
            if (element.closest?.(`.${TOPBAR_ROOT_CLASS}`)) return true;
            if (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT") return true;
            if (element.isContentEditable) return true;
            return false;
        };

        const translateTextNode = (textNode) => {
            if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
            const parent = textNode.parentElement;
            if (!parent || shouldSkipElement(parent)) return;

            const original = textNode.nodeValue;
            const trimmed = original?.trim?.();
            const translated = getStatusTranslation(trimmed);
            if (!translated) return;

            const leadingWhitespace = original.match(/^\s*/)?.[0] || "";
            const trailingWhitespace = original.match(/\s*$/)?.[0] || "";
            textNode.nodeValue = `${leadingWhitespace}${translated}${trailingWhitespace}`;
        };

        const translateElementTitle = (element) => {
            if (!element || !element.title || shouldSkipElement(element)) return;
            const translated = getStatusTranslation(element.title);
            if (translated) {
                element.title = translated;
            }
        };

        const scanContainer = (container) => {
            if (!container) return;
            translateElementTitle(container);

            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let currentNode = walker.nextNode();
            while (currentNode) {
                translateTextNode(currentNode);
                currentNode = walker.nextNode();
            }

            container.querySelectorAll?.("[title]").forEach((element) => {
                translateElementTitle(element);
            });
        };

        const observerOptions = {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["title"],
        };

        if (!window._dd_topbar_status_observed_roots) {
            window._dd_topbar_status_observed_roots = new WeakSet();
        }

        const observeRoot = (root) => {
            if (!root || !window._dd_topbar_status_observer) return;
            if (window._dd_topbar_status_observed_roots.has(root)) return;
            window._dd_topbar_status_observed_roots.add(root);
            window._dd_topbar_status_observer.observe(root, observerOptions);
        };

        if (!window._dd_topbar_status_scanned_roots) {
            window._dd_topbar_status_scanned_roots = new WeakSet();
        }
        if (!window._dd_topbar_shadow_scan_queue) {
            window._dd_topbar_shadow_scan_queue = [];
        }
        if (!window._dd_topbar_shadow_scanned_containers) {
            window._dd_topbar_shadow_scanned_containers = new WeakSet();
        }

        const tryHandleShadowHost = (host) => {
            const shadowRoot = host?.shadowRoot;
            if (!shadowRoot) return;
            scanContainer(shadowRoot);
            observeRoot(shadowRoot);
            enqueueShadowScan(shadowRoot);
        };

        const enqueueShadowScan = (container) => {
            if (!container) return;
            if (window._dd_topbar_shadow_scanned_containers.has(container)) return;
            window._dd_topbar_shadow_scanned_containers.add(container);

            let walker = null;
            try {
                walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
            } catch (e) {
                walker = null;
            }

            window._dd_topbar_shadow_scan_queue.push({
                container,
                walker,
                didHostCheck: false,
            });

            scheduleShadowScan();
        };

        const scheduleShadowScan = () => {
            if (window._dd_topbar_shadow_scan_raf) return;
            window._dd_topbar_shadow_scan_raf = window.requestAnimationFrame(() => {
                window._dd_topbar_shadow_scan_raf = 0;
                processShadowScanQueue();
            });
        };

        const processShadowScanQueue = () => {
            const queue = window._dd_topbar_shadow_scan_queue || [];
            let budget = 240;

            while (queue.length && budget > 0) {
                const job = queue[0];
                const container = job.container;

                if (!container) {
                    queue.shift();
                    continue;
                }
                if (container.nodeType === Node.ELEMENT_NODE && shouldSkipElement(container)) {
                    queue.shift();
                    continue;
                }

                if (!job.didHostCheck) {
                    job.didHostCheck = true;
                    if (container.nodeType === Node.ELEMENT_NODE) {
                        tryHandleShadowHost(container);
                    }
                }

                if (!job.walker) {
                    queue.shift();
                    continue;
                }

                const node = job.walker.nextNode();
                if (!node) {
                    queue.shift();
                    continue;
                }

                tryHandleShadowHost(node);
                budget -= 1;
            }

            if (queue.length) {
                scheduleShadowScan();
            }
        };

        const scanRootOnce = (root) => {
            if (!root) return;
            if (window._dd_topbar_status_scanned_roots.has(root)) return;
            window._dd_topbar_status_scanned_roots.add(root);
            scanContainer(root);
            enqueueShadowScan(root);
        };

        const attachAndScanRoots = () => {
            const roots = getTopbarRoots();
            if (!roots.length) return;

            roots.forEach((root) => {
                observeRoot(root);
                scanRootOnce(root);
            });
        };

        window._dd_topbar_status_attach = attachAndScanRoots;
        attachAndScanRoots();
        ensureTopbarStatusBootstrapObserver();

        if (!window._dd_topbar_status_observer) {
            let pendingMutations = [];
            let scheduled = false;

            const flushMutations = () => {
                scheduled = false;
                const mutationsList = pendingMutations;
                pendingMutations = [];

                for (const mutation of mutationsList) {
                    if (mutation.type === "childList") {
                        mutation.addedNodes.forEach((node) => {
                            if (node?.nodeType === Node.TEXT_NODE) {
                                translateTextNode(node);
                            } else if (node?.nodeType === Node.ELEMENT_NODE) {
                                scanContainer(node);
                                enqueueShadowScan(node);
                            }
                        });
                    } else if (mutation.type === "characterData") {
                        translateTextNode(mutation.target);
                    } else if (mutation.type === "attributes" && mutation.target?.nodeType === Node.ELEMENT_NODE) {
                        translateElementTitle(mutation.target);
                        tryHandleShadowHost(mutation.target);
                    }
                }
            };

            window._dd_topbar_status_observer = new MutationObserver((mutationsList) => {
                pendingMutations.push(...mutationsList);
                if (scheduled) return;

                scheduled = true;
                window.requestAnimationFrame(flushMutations);
            });

            attachAndScanRoots();
        }
    } catch (e) {
        error?.("顶部状态栏定点翻译失败:", e);
    }
}

export function installTopbarTranslation(deps = {}) {
    installTopbarButton(deps);
    
    const runStatusInstall = () => {
        installTopbarStatusTranslation(deps);
    };
    
    runStatusInstall();
}
