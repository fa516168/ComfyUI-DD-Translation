import { 
  containsChineseCharacters, 
  nativeTranslatedSettings,
  error,
  isVueNodes2,
  shouldSkipNode
} from "./utils.js";

/**
 * 翻译执行器类
 */
class TExe {
  static T = null;

  canonicalizeMenuText(raw) {
    return String(raw || "")
      .replace(/\uFE0F/g, "")
      .replace(/&nbsp;|&#160;|\u00A0/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/\);\s*;$/, ")")
      .replace(/\s*;\s*$/, "")
      .trim();
  }

  ensureMenuIndex(menuT) {
    try {
      if (!menuT) return;
      if (
        this._menuTRef === menuT
        && this._lowerKeyMap
        && this._normalizedKeyMap
        && this._placeholderEntriesRef === menuT
        && Array.isArray(this._placeholderEntries)
      ) {
        return;
      }
      this._menuTRef = menuT;
      this._lowerKeyMap = new Map();
      this._normalizedKeyMap = new Map();
      this._placeholderEntriesRef = menuT;
      this._placeholderEntries = [];

      const normalize = (s) => this.canonicalizeMenuText(s).toLowerCase().replace(/[_\s-]/g, "");
      for (const k in menuT) {
        if (!Object.prototype.hasOwnProperty.call(menuT, k)) continue;
        const v = menuT[k];
        if (typeof v !== "string") continue;
        const lower = this.canonicalizeMenuText(k).toLowerCase();
        if (!this._lowerKeyMap.has(lower)) this._lowerKeyMap.set(lower, v);
        const nk = normalize(k);
        if (nk && !this._normalizedKeyMap.has(nk)) this._normalizedKeyMap.set(nk, v);

        if (k.includes("${") || (k.includes("{") && k.includes("}"))) {
          const regex = this.getRegexForKey(k);
          if (!regex) continue;
          const placeholders = k.match(/\$\{[^}]*\}|\{[^}]*\}/g) || [];
          this._placeholderEntries.push({
            key: k,
            regex,
            placeholders,
            template: v,
          });
        }
      }
    } catch (e) {
      // ignore
    }
  }

  getMenuTranslationLoose(menuT, txt) {
    try {
      if (!menuT || typeof txt !== "string" || !txt) return null;
      this.ensureMenuIndex(menuT);
      const trimmed = this.canonicalizeMenuText(txt);
      const lower = trimmed.toLowerCase();
      const byLower = this._lowerKeyMap?.get(lower);
      if (byLower) return byLower;
      const normalized = lower.replace(/[_\s-]/g, "");
      const byNorm = this._normalizedKeyMap?.get(normalized);
      if (byNorm) return byNorm;
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 翻译指定文本
   * @param {string} txt 需要翻译的文本
   * @returns {string|null} 翻译后的文本或null
   */
  MT(txt) {
    if (typeof txt !== "string" || !txt) return null;
    if (this.mtCache?.has(txt)) return this.mtCache.get(txt) || null;
    const normalizedTxt = this.canonicalizeMenuText(txt);

    // 1. 直接匹配
    const menuT = this.T?.Menu;
    if (!menuT) return null;

    const trimmedTxt = txt.trim?.() || txt;
    const htmlEntityVariant = txt.replace(/'/g, "&apos;");
    const quoteVariant = txt.replace(/&apos;/g, "'");
    const canonicalTxt = this.canonicalizeMenuText(txt);
    const canonicalTrimmedTxt = this.canonicalizeMenuText(trimmedTxt);
    const canonicalHtmlEntityVariant = this.canonicalizeMenuText(htmlEntityVariant);
    const canonicalQuoteVariant = this.canonicalizeMenuText(quoteVariant);
    const directMatch =
      menuT[txt] ||
      menuT[trimmedTxt] ||
      menuT[htmlEntityVariant] ||
      menuT[quoteVariant] ||
      menuT[canonicalTxt] ||
      menuT[canonicalTrimmedTxt] ||
      menuT[canonicalHtmlEntityVariant] ||
      menuT[canonicalQuoteVariant];
    if (directMatch) return directMatch;

    const looseMatch =
      this.getMenuTranslationLoose(menuT, txt) ||
      this.getMenuTranslationLoose(menuT, trimmedTxt) ||
      this.getMenuTranslationLoose(menuT, htmlEntityVariant) ||
      this.getMenuTranslationLoose(menuT, quoteVariant) ||
      this.getMenuTranslationLoose(menuT, canonicalTxt) ||
      this.getMenuTranslationLoose(menuT, canonicalTrimmedTxt) ||
      this.getMenuTranslationLoose(menuT, canonicalHtmlEntityVariant) ||
      this.getMenuTranslationLoose(menuT, canonicalQuoteVariant);
    if (looseMatch) return looseMatch;

    // 文本里只有中文（不含英文）时，不再继续做复杂匹配，避免无意义扫描
    if (containsChineseCharacters(txt) && !/[A-Za-z]/.test(txt)) {
      return null;
    }

    // 2. 带有占位符的正则匹配 (例如 ${index}, {0}, {})

    try {
      // 文件/模型扩展名保护：以模型、媒体等文件扩展名结尾的文本（如 xxx.safetensors）
      // 不做占位符模板翻译，避免 "${00}.{00}s" 类模板把文件名末尾的 s 误翻译成"秒"。
      if (/\.(?:safetensors|safetensor|ckpt|pt|pt2|pth|bin|gguf|onnx|json|yaml|yml|txt|csv|jpg|jpeg|png|webp|gif|mp4|mov|avi|wav|mp3)$/i.test(normalizedTxt)) {
        this.mtCache?.set(txt, null);
        if (this.mtCache && this.mtCache.size > this.mtCacheMax) {
          const firstKey = this.mtCache.keys().next().value;
          if (firstKey !== undefined) this.mtCache.delete(firstKey);
        }
        return null;
      }
      this.ensureMenuIndex(menuT);
      const entries = this._placeholderEntries || [];
      for (const entry of entries) {
        const match = normalizedTxt.match(entry.regex);
        if (!match) continue;
        let translated = entry.template;
        const placeholders = entry.placeholders || [];
        for (let index = 0; index < placeholders.length; index++) {
          const ph = placeholders[index];
          const value = match[index + 1];
          if (value !== undefined) {
            translated = translated.split(ph).join(value);
          }
        }

        this.mtCache?.set(txt, translated);
        if (this.mtCache && this.mtCache.size > this.mtCacheMax) {
          const firstKey = this.mtCache.keys().next().value;
          if (firstKey !== undefined) this.mtCache.delete(firstKey);
        }

        return translated;
      }
    } catch (e) {
      return null;
    }

    this.mtCache?.set(txt, null);
    if (this.mtCache && this.mtCache.size > this.mtCacheMax) {
      const firstKey = this.mtCache.keys().next().value;
      if (firstKey !== undefined) this.mtCache.delete(firstKey);
    }

    return null;
  }

  /**
   * 为带有占位符的键生成正则表达式
   * @param {string} key 
   * @returns {RegExp|null}
   */
  getRegexForKey(key) {
    if (!this.regexCache) this.regexCache = new Map();
    if (this.regexCache.has(key)) return this.regexCache.get(key);

    try {
      const normalizeTemplateText = (s) =>
        String(s || "")
          .replace(/\uFE0F/g, "")
          .replace(/\s+/g, " ")
          .trim();

      // 转义正则特殊字符，但保留我们需要的占位符结构
      let regexStr = normalizeTemplateText(key).replace(/[.*+?^${}()|[\]\\]/g, (m) => {
        if (m === '$' || m === '{' || m === '}') return m;
        return '\\' + m;
      });

      // 将占位符替换为非贪婪捕获组 (.*?)
      // 支持 ${name}, {0}, {} 等格式
      regexStr = regexStr
        .replace(/\$\{[^}]*\}/g, '(.*?)')
        .replace(/\{[^}]*\}/g, '(.*?)')
        .replace(/\s+/g, '\\s+');
      
      const regex = new RegExp('^' + regexStr + '$');
      this.regexCache.set(key, regex);
      return regex;
    } catch (e) {
      return null;
    }
  }

  constructor() {
    // 不需要翻译的CSS类列表
    this.excludeClass = ["lite-search-item-type", "lite-search", "lite-searchbox", "litegraph-searchbox"];
    // 记录已注册的观察者，便于后续管理
    this.observers = [];
    // 缓存正则表达式
    this.regexCache = new Map();
    this.mtCache = new Map();
    this.mtCacheMax = 2000;
    this._placeholderEntriesRef = null;
    this._placeholderEntries = [];
    this._vueScanState = new WeakMap();
  }

  /**
   * 检查是否需要跳过翻译
   * @param {HTMLElement} node DOM节点
   * @returns {boolean} 是否需要跳过
   */
  tSkip(node) {
    return shouldSkipNode(
      node,
      this.excludeClass,
      '.workflow-list, .workflow, .workflows, .file-list, .file-browser, .p-tree, .p-treenode, .p-inputtext'
    );
  }
  translateKjPopDesc(node) {
    try {
      let T = this.T;
      if (!T) return false;
      if (!node) return false;
      if (!node?.classList?.contains("kj-documentation-popup")) return false;

      this.replaceText(node);
      return true;
    } catch (e) {
      error("翻译KJ弹窗出错:", e);
      return false;
    }
  }
  translateAllText(node) {
    try {
      let T = this.T;
      if (!T) return;
      if (!node) return;

      this.replaceText(node);
    } catch (e) {
      error("翻译所有文本出错:", e);
    }
  }

  /**
   * 替换文本内容为翻译后的文本
   * @param {Node} target 目标节点
   */
  replaceText(target) {
    try {
      if (!target) return;
      if (!this.T) return;
      if (this.tSkip(target)) return;
      
      // 如果节点的内容是原生已翻译的设置项，跳过翻译
      if (target.textContent && nativeTranslatedSettings.includes(target.textContent)) {
        return;
      }
      
      // 处理子节点
      if (target.childNodes && target.childNodes.length) {
        // 创建一个副本来遍历，避免在遍历过程中修改导致问题
        const childNodes = Array.from(target.childNodes);
        for (const childNode of childNodes) {
          this.replaceText(childNode);
        }
      }
      
      // 处理当前节点
      if (target.nodeType === Node.TEXT_NODE) {
        // 文本节点
        if (target.nodeValue) {
          const translated = this.MT(target.nodeValue);
          if (translated && translated !== target.nodeValue) {
            target.nodeValue = translated;
          }
        }
      } else if (target.nodeType === Node.ELEMENT_NODE) {
        // 元素节点
        
        // 处理 title 属性
        if (target.title) {
          const titleTranslated = this.MT(target.title);
          if (titleTranslated && titleTranslated !== target.title) {
            target.title = titleTranslated;
          }
        }

        // 处理按钮值
        if (target.nodeName === "INPUT" && target.type === "button") {
          const valueTranslated = this.MT(target.value);
          if (valueTranslated && valueTranslated !== target.value) {
            target.value = valueTranslated;
          }
        }

        // 处理select和option元素
        if (target.nodeName === "SELECT") {
          // 确保翻译下拉框中的选项
          Array.from(target.options).forEach(option => {
            if (option.text) {
              const optionTextTranslated = this.MT(option.text);
              if (optionTextTranslated && optionTextTranslated !== option.text) {
                option.text = optionTextTranslated;
              }
            }
          });
        }
      }
    } catch (e) {
      error("替换文本出错:", e);
    }
  }
    cleanupObservers() {
    try {
      this.observers.forEach(observer => {
        if (observer && typeof observer.disconnect === 'function') {
          observer.disconnect();
        }
      });
      this.observers = [];
    } catch (e) {
      error("清理观察者出错:", e);
    }
  }

  /**
   * Safe text replacement for Vue mode (Text nodes and attributes only)
   * @param {Node} target 
   */
  safeReplaceVue(target) {
    try {
      this.safeReplaceVueBatched(target, 1000000);
    } catch (e) {
      // error("Safe replace error:", e);
    }
  }

  safeReplaceVueBatched(root, maxNodes = 500) {
    try {
      if (!root) return true;
      if (!this.T) return true;

      const state = this._vueScanState.get(root) || { stack: [root] };
      this._vueScanState.set(root, state);

      let processed = 0;
      while (state.stack.length && processed < maxNodes) {
        const node = state.stack.pop();
        processed++;
        const shouldDescend = this.safeReplaceVueNode(node);
        if (!shouldDescend) continue;

        const childNodes = node.childNodes;
        if (!childNodes || !childNodes.length) continue;
        for (let i = childNodes.length - 1; i >= 0; i--) {
          state.stack.push(childNodes[i]);
        }
      }

      if (!state.stack.length) {
        this._vueScanState.delete(root);
        return true;
      }

      return false;
    } catch (e) {
      return true;
    }
  }

  safeReplaceVueNode(target) {
    try {
      if (!target) return false;
      if (!this.T) return false;
      if (this.tSkip(target)) return false;

      if (target.nodeType === Node.TEXT_NODE) {
        const value = target.nodeValue;
        if (value) {
          if (!(containsChineseCharacters(value) && !/[A-Za-z]/.test(value))) {
            const translated = this.MT(value);
            if (translated && translated !== value) {
              target.nodeValue = translated;
            }
          }
        }
        return false;
      }

      if (target.nodeType !== Node.ELEMENT_NODE) return false;

      if (target.tagName === "CANVAS") return false;
      const inSearchOverlay = target.closest?.(".lite-search, .lite-searchbox, .litegraph-searchbox");
      if (inSearchOverlay) return false;

      if (target.title) {
        const t = this.MT(target.title);
        if (t && t !== target.title) target.title = t;
      }
      if (target.placeholder) {
        const t = this.MT(target.placeholder);
        if (t && t !== target.placeholder) target.placeholder = t;
      }
      if (target.tagName === "INPUT" && target.type === "button") {
        const t = this.MT(target.value);
        if (t && t !== target.value) target.value = t;
      }

      return true;
    } catch (e) {
      return false;
    }
  }
}

// 创建翻译执行器实例
let texe = new TExe();

function isLikelyDynamicMenuLabel(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (containsChineseCharacters(trimmed) && !/[A-Za-z]/.test(trimmed)) {
    return true;
  }

  if (/[\\/]/.test(trimmed)) return true;
  if (/\.(?:safetensors|ckpt|pt|pt2|bin|pth|gguf|onnx|json|yaml|yml|txt|csv|jpg|jpeg|png|webp|gif|mp4|mov|avi|wav|mp3)$/i.test(trimmed)) {
    return true;
  }
  if (!/\s/.test(trimmed) && /[_.-]/.test(trimmed)) return true;
  if (!/\s/.test(trimmed) && /\d/.test(trimmed) && /[A-Za-z]/.test(trimmed)) return true;

  return false;
}

export function translateMenuText(text, menuT) {
  if (typeof text !== "string" || !text) return text;
  if (!menuT) return text;
  if (isLikelyDynamicMenuLabel(text)) return text;

  const previousMenu = texe.T?.Menu;
  if (previousMenu !== menuT) {
    texe.T = Object.assign({}, texe.T || {}, { Menu: menuT });
  }

  const translatedByMap = texe.MT(text);
  if (translatedByMap) return translatedByMap;

  let translated = text.replace(/\$\$[A-Za-z0-9_.-]+/g, (token) => {
    return texe.MT(token) || token;
  });
  translated = translated.replace(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/gi, (token) => {
    return texe.MT(token) || token;
  });

  return translated;
}

export function unwrapTranslatedMenuValue(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "__dd_original_value")) {
    return value.__dd_original_value;
  }
  return value;
}

function createTranslatedMenuEntry(rawValue, displayText) {
  return {
    content: displayText,
    value: rawValue,
    __dd_original_value: rawValue,
  };
}

function addDisplayMapping(textMap, rawText, displayText) {
  if (typeof rawText !== "string" || !rawText) return;
  if (typeof displayText !== "string" || !displayText || displayText === rawText) return;

  textMap.set(rawText, displayText);

  const trimmedRaw = rawText.trim();
  if (trimmedRaw && trimmedRaw !== rawText && !textMap.has(trimmedRaw)) {
    textMap.set(trimmedRaw, displayText);
  }
}

function createMenuHelperContext(helpers = {}) {
  const menuT = helpers.menuTranslations || null;
  const lookupMenuTranslation = typeof helpers.lookupMenuTranslation === "function"
    ? helpers.lookupMenuTranslation
    : (text) => null;
  return {
    menuT,
    getNodeTitle: typeof helpers.getNodeTitle === "function" ? helpers.getNodeTitle : () => null,
    getWidgetNameTranslation: typeof helpers.getWidgetNameTranslation === "function"
      ? helpers.getWidgetNameTranslation
      : () => null,
    lookupMenuTranslation,
    getMenuTranslation: typeof helpers.getMenuTranslation === "function"
      ? helpers.getMenuTranslation
      : (text) => lookupMenuTranslation(text) || translateMenuText(text, menuT),
  };
}

function buildWidgetStringTranslation(widget, lookupMenuTranslation) {
  if (!widget || typeof widget.value !== "string") return null;

  const rawValue = widget.value.trim();
  if (!rawValue) return null;

  const widgetName = typeof widget.name === "string" ? widget.name.trim() : "";
  const lowerValue = rawValue.toLowerCase();
  const lowerWidgetName = widgetName.toLowerCase();

  const looksLikeWidgetNameValue =
    !!widgetName &&
    (
      lowerValue === lowerWidgetName ||
      lowerValue.startsWith(`${lowerWidgetName}(`) ||
      lowerValue.startsWith(`${lowerWidgetName} (`)
    );

  const suffixMatch = rawValue.match(/^(.*?)(\s*[\(\（][^()\u2E80-\u9FFF]*[\)\）])$/);
  if (suffixMatch) {
    const base = suffixMatch[1].trim();
    const suffix = suffixMatch[2];
    // 优先尝试获取完整文本的精确翻译（例如 "1:1 (Square)" -> "1:1 (正方形)"）
    const exactTranslation = lookupMenuTranslation(rawValue);
    if (exactTranslation && exactTranslation !== rawValue) {
      return exactTranslation;
    }
    const baseTranslation = lookupMenuTranslation(base);
    if (baseTranslation && baseTranslation !== base) {
      return `${baseTranslation}${suffix}`;
    }
  }

  if (looksLikeWidgetNameValue) {
    const nameTranslation = lookupMenuTranslation(widgetName);
    if (nameTranslation && nameTranslation !== widgetName) {
      if (lowerValue === lowerWidgetName) {
        return nameTranslation;
      }
      const escapedWidgetName = widgetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return rawValue.replace(
        new RegExp(`^${escapedWidgetName}(?=\\s*[\\(（])`, "i"),
        nameTranslation
      );
    }
  }

  return null;
}

export function createWidgetDrawTextTranslator(widgets, helpers = {}) {
  const {
    getWidgetNameTranslation,
    lookupMenuTranslation,
    getMenuTranslation,
  } = createMenuHelperContext(helpers);
  const getWidgetStringTranslation = typeof helpers.getWidgetStringTranslation === "function"
    ? helpers.getWidgetStringTranslation
    : (widget) => buildWidgetStringTranslation(widget, lookupMenuTranslation);
  const textMap = new Map();
  const resolvedTextCache = new Map();

  if (Array.isArray(widgets)) {
    for (const widget of widgets) {
      const widgetNameTranslation = getWidgetNameTranslation(widget);
      addDisplayMapping(textMap, widget?.name, widgetNameTranslation);

      if (widget?.type === "combo" && typeof widget.value === "string") {
        addDisplayMapping(textMap, widget.value, getMenuTranslation(widget.value));
      }

      if (widget?.type === "toggle" && widget.options) {
        const onText = widget.options.hasOwnProperty("on") ? widget.options.on : "true";
        const offText = widget.options.hasOwnProperty("off") ? widget.options.off : "false";
        addDisplayMapping(textMap, onText, getMenuTranslation(onText));
        addDisplayMapping(textMap, offText, getMenuTranslation(offText));
      }

      if (typeof widget?.value === "string") {
        addDisplayMapping(textMap, widget.value, getWidgetStringTranslation(widget));
      }
    }
  }

  return function translateDrawnText(text) {
    if (typeof text !== "string" || !text) return text;

    if (resolvedTextCache.has(text)) {
      return resolvedTextCache.get(text);
    }

    const mapped = textMap.get(text) || textMap.get(text.trim());
    if (mapped) {
      resolvedTextCache.set(text, mapped);
      return mapped;
    }

    // 优先尝试获取完整文本的精确翻译（例如 "1:1 (Square)" -> "1:1 (正方形)"）
    const exactTranslation = lookupMenuTranslation(text);
    if (exactTranslation && exactTranslation !== text) {
      resolvedTextCache.set(text, exactTranslation);
      return exactTranslation;
    }

    const suffixMatch = text.match(/^(.*?)(\s*[\(\（][^()\u2E80-\u9FFF]*[\)\）])$/);
    if (suffixMatch) {
      const base = suffixMatch[1].trim();
      const suffix = suffixMatch[2];
      const baseTranslation = lookupMenuTranslation(base);
      if (baseTranslation && baseTranslation !== base) {
        const translated = `${baseTranslation}${suffix}`;
        resolvedTextCache.set(text, translated);
        return translated;
      }
    }

    const translated = getMenuTranslation(text) || text;
    resolvedTextCache.set(text, translated);
    return translated;
  };
}

export function translateContextMenuPayload(values, options, helpers = {}) {
  const { menuT, getNodeTitle, getMenuTranslation } = createMenuHelperContext(helpers);
  let hasWrappedStringEntry = false;

  const nextOptions = options && typeof options === "object" ? { ...options } : options;
  if (nextOptions && Object.prototype.hasOwnProperty.call(nextOptions, "title")) {
    const translatedTitle = getNodeTitle(nextOptions.title) || translateMenuText(nextOptions.title, menuT);
    if (translatedTitle) {
      nextOptions.title = translatedTitle;
    }
  }

  if (!Array.isArray(values)) {
    return { values, options: nextOptions };
  }

  const reInput = /Convert (.*) to input/;
  const reWidget = /Convert (.*) to widget/;
  const convertPrefix = getMenuTranslation("Convert ") || "Convert ";
  const inputSuffix = getMenuTranslation(" to input") || " to input";
  const widgetSuffix = getMenuTranslation(" to widget") || " to widget";
  const extraInfo = nextOptions?.extra || nextOptions?.parentMenu?.options?.extra;

  const resolvePortLabel = (rawName) => {
    let resolvedName = rawName;
    extraInfo?.inputs?.find((item) => {
      if (item.name !== resolvedName) return false;
      resolvedName = item.label || item.name;
      return true;
    });
    extraInfo?.widgets?.find((item) => {
      if (item.name !== resolvedName) return false;
      resolvedName = item.label || item.name;
      return true;
    });
    return resolvedName;
  };

  const nextValues = values.map((value) => {
    if (typeof value === "string" && value) {
      const translatedString = translateMenuText(value, menuT);
      if (translatedString && translatedString !== value) {
        hasWrappedStringEntry = true;
        return createTranslatedMenuEntry(value, translatedString);
      }
      return value;
    }

    if (value == null || !Object.prototype.hasOwnProperty.call(value, "content")) {
      return value;
    }

    const translatedValue = { ...value };
    const nodeTitle = getNodeTitle(translatedValue.value);
    if (nodeTitle) {
      translatedValue.content = nodeTitle;
      return translatedValue;
    }

    const translatedContent = translateMenuText(translatedValue.content, menuT);
    if (translatedContent && translatedContent !== translatedValue.content) {
      translatedValue.content = translatedContent;
      return translatedValue;
    }

    const matchInput = translatedValue.content?.match(reInput);
    if (matchInput) {
      translatedValue.content = `${convertPrefix}${resolvePortLabel(matchInput[1])}${inputSuffix}`;
      return translatedValue;
    }

    const matchWidget = translatedValue.content?.match(reWidget);
    if (matchWidget) {
      translatedValue.content = `${convertPrefix}${resolvePortLabel(matchWidget[1])}${widgetSuffix}`;
      return translatedValue;
    }

    return translatedValue;
  });

  if (hasWrappedStringEntry && nextOptions && typeof nextOptions.callback === "function") {
    const originalCallback = nextOptions.callback;
    nextOptions.callback = function(value, ...restArgs) {
      const normalizedValue = unwrapTranslatedMenuValue(value);
      return originalCallback.call(this, normalizedValue, ...restArgs);
    };
  }

  return { values: nextValues, options: nextOptions };
}

export function installContextMenuTranslation(LiteGraphRef, helpers = {}) {
  if (!LiteGraphRef) return false;

  const OriginalContextMenu = LiteGraphRef.ContextMenu;
  if (typeof OriginalContextMenu !== "function") return false;
  if (OriginalContextMenu._dd_translation_hooked) return true;

  function DDTranslatedContextMenu(values, options) {
    const translatedPayload = translateContextMenuPayload(values, options, helpers) || { values, options };

    if (new.target) {
      return Reflect.construct(
        OriginalContextMenu,
        [translatedPayload.values, translatedPayload.options],
        new.target
      );
    }

    return OriginalContextMenu.call(this, translatedPayload.values, translatedPayload.options);
  }

  Object.setPrototypeOf(DDTranslatedContextMenu, OriginalContextMenu);
  DDTranslatedContextMenu.prototype = OriginalContextMenu.prototype;
  DDTranslatedContextMenu._dd_translation_hooked = true;
  DDTranslatedContextMenu._dd_original = OriginalContextMenu;

  LiteGraphRef.ContextMenu = DDTranslatedContextMenu;
  return true;
}

function applyVueMenuTranslation(T) {
    try {
        // 1. Try comfyAPI i18n
        if (window.comfyAPI && window.comfyAPI.i18n && window.comfyAPI.i18n.addTranslations) {
            window.comfyAPI.i18n.addTranslations('zh-CN', T.Menu);
            return;
        }
        
        // Merge node input/widget terms (only snake_case) into menu dictionary for safe text replacement
        try {
          const extra = {};
          const nodes = T.Nodes || {};
          for (const cls in nodes) {
            const nt = nodes[cls];
            if (nt?.inputs) {
              for (const k in nt.inputs) {
                const v = nt.inputs[k];
                if (typeof v === 'string' && !extra[k] && k.includes('_')) extra[k] = v;
              }
            }
            if (nt?.widgets) {
              for (const k in nt.widgets) {
                const v = nt.widgets[k];
                if (typeof v === 'string' && !extra[k] && k.includes('_')) extra[k] = v;
              }
            }
          }
          texe.T.Menu = Object.assign({}, texe.T.Menu || {}, extra);
        } catch (e) {}
        // 2. Fallback: Targeted MutationObservers (avoid sidebar/workflow list)
        const targets = [
          document.querySelector('.litegraph'),
          document.querySelector('.comfyui-menu'),
          document.querySelector('.comfy-menu'),
          ...Array.from(document.querySelectorAll('.comfyui-popup')),
          ...Array.from(document.querySelectorAll('.comfy-modal')),
          ...Array.from(document.querySelectorAll('.p-dialog'))
        ].filter(Boolean);

        const perfEnabled = () => {
          try {
            return window?.localStorage?.getItem("dd_translation_perf") === "1";
          } catch (e) {
            return false;
          }
        };

        const now = () => {
          try {
            return window?.performance?.now?.() ?? Date.now();
          } catch (e) {
            return Date.now();
          }
        };

        const queue = new Set();
        let scheduled = false;
        let lastPerfLogAt = 0;

        const flush = () => {
          scheduled = false;
          const start = now();
          const frameBudgetMs = 8;
          const batchSize = 400;

          while (queue.size && (now() - start) < frameBudgetMs) {
            const node = queue.values().next().value;
            queue.delete(node);
            const done = texe.safeReplaceVueBatched(node, batchSize);
            if (!done) queue.add(node);
          }

          if (queue.size) {
            scheduled = true;
            window.requestAnimationFrame(flush);
          }

          if (perfEnabled()) {
            const t = now();
            if (t - lastPerfLogAt > 2000) {
              lastPerfLogAt = t;
              console.log("[DD-Translation][perf] vue-queue:", queue.size);
            }
          }
        };

        const enqueue = (node) => {
          if (!node) return;
          if (node.nodeType === Node.TEXT_NODE) {
            texe.safeReplaceVueNode(node);
            return;
          }
          queue.add(node);
          if (scheduled) return;
          scheduled = true;
          window.requestAnimationFrame(flush);
        };

        targets.forEach(t => {
          enqueue(t);
          const obs = observeFactory(t, (mutationsList) => {
            for (let mutation of mutationsList) {
              if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => enqueue(node));
              }
            }
          }, true, { attributes: false, characterData: false });
          if (obs) texe.observers.push(obs);
        });


    } catch (e) {
        error("Vue mode translation failed:", e);
    }
}

export function applyMenuTranslation(T) {
  try {
    texe.cleanupObservers();
    texe.T = T;
    
    if (isVueNodes2()) {
        applyVueMenuTranslation(T);
        return;
    }
    return;
  } catch (e) {
    error("应用菜单翻译出错:", e);
  }
}

/**
 * 观察者工厂函数
 * @param {HTMLElement} observeTarget 观察目标
 * @param {Function} fn 回调函数
 * @param {boolean} subtree 是否观察子树
 * @returns {MutationObserver} 观察者实例
 */
export function observeFactory(observeTarget, fn, subtree = false, options = {}) {
  if (!observeTarget) return null;
  try {
    const observer = new MutationObserver(function (mutationsList, observer) {
      fn(mutationsList, observer);
    });
    const defaultOpts = { childList: true, attributes: true, subtree, characterData: false };
    const observeOptions = Object.assign(defaultOpts, options || {});
    observer.observe(observeTarget, observeOptions);
    return observer;
  } catch (e) {
    error("创建观察者出错:", e);
    return null;
  }
}

/**
 * 处理模态框节点
 * @param {HTMLElement} node 模态框节点
 */
 

/**
 * 处理ComfyUI新版UI菜单
 * @param {MutationRecord[]} mutationsList 变更记录列表
 */
function handleComfyNewUIMenu(mutationsList) {
  for (let mutation of mutationsList) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(node => texe.translateAllText(node));
    } else if (mutation.type === 'attributes' || mutation.type === 'characterData') {
      texe.replaceText(mutation.target);
    }
  }
}

 

/**
 * 处理视图队列和Comfy列表观察者
 * @param {MutationRecord[]} mutationsList 变更记录列表
 */
 

/**
 * 处理设置对话框
 */
 

/**
 * 处理新版设置观察者
 * @param {MutationRecord[]} mutationsList 变更记录列表
 */
 

/**
 * 翻译设置对话框
 * @param {HTMLElement} comfySettingDialog 设置对话框
 */
 

/**
 * 设置搜索框观察者
 */
 
