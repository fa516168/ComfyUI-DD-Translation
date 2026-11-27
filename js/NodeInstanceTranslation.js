import {
  containsChineseCharacters,
  error,
  hasNativeTranslation,
  isAlreadyTranslated,
  isTranslationEnabled,
} from "./utils.js";

function needsTranslation(item) {
  if (!item || !Object.prototype.hasOwnProperty.call(item, "name")) return false;
  if (isAlreadyTranslated(item.name, item.label)) return false;
  if (containsChineseCharacters(item.name)) return false;
  return true;
}

function getOriginalLabel(item) {
  if (!item) return null;
  if (typeof item._dd_original_label === "string" && item._dd_original_label) {
    return item._dd_original_label;
  }
  if (typeof item.label === "string" && item.label) {
    return item.label;
  }
  if (typeof item.name === "string" && item.name) {
    return item.name;
  }
  return null;
}

function getLookupKeys(item) {
  if (!item) return [];

  const rawName =
    typeof item.widget?.name === "string" && item.widget.name.trim()
      ? item.widget.name.trim()
      : typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : "";
  const originalLabel = typeof getOriginalLabel(item) === "string" ? getOriginalLabel(item).trim() : "";
  const keys = [];

  if (originalLabel && originalLabel !== rawName && !containsChineseCharacters(originalLabel)) {
    keys.push(originalLabel);
  }
  if (rawName) {
    keys.push(rawName);

    // COMFY_AUTOGROW 等动态端口组件运行时生成的端口，内部名形如 "group.base_0"
    // （例如 ref_images.ref_image_0），而翻译表是按去掉命名空间前缀后的 "base_0" 编写的。
    // 这里把最后一段也作为查找 key，否则这类动态端口永远查不到翻译。
    if (rawName.includes(".")) {
      const lastSegment = rawName.split(".").pop();
      if (lastSegment && lastSegment !== rawName) {
        keys.push(lastSegment);
      }
    }
  }

  return [...new Set(keys)];
}

function normalizeSocketType(typeValue) {
  if (Array.isArray(typeValue)) {
    for (const value of typeValue) {
      const normalized = normalizeSocketType(value);
      if (normalized) return normalized;
    }
    return null;
  }
  if (typeof typeValue !== "string") return null;

  const cleaned = typeValue.trim();
  if (!cleaned || cleaned === "*" || cleaned === "0") return null;
  return cleaned.toUpperCase();
}

function getSocketTypeLabel(item) {
  const typeName = normalizeSocketType(item?.type);
  if (!typeName) return null;

  const typeLabelMap = {
    LATENT: "Latent",
    VAE: "VAE",
    IMAGE: "图像",
    AUDIO: "音频",
    MASK: "遮罩",
    MODEL: "模型",
    CLIP: "CLIP",
    CONDITIONING: "条件",
  };

  return typeLabelMap[typeName] || null;
}

function applySocketTypeFallback(item, translated) {
  if (!item) return translated;

  const itemName =
    typeof item.widget?.name === "string" && item.widget.name.trim()
      ? item.widget.name.trim().toLowerCase()
      : typeof item.name === "string" && item.name.trim()
        ? item.name.trim().toLowerCase()
        : "";
  const typeLabel = getSocketTypeLabel(item);

  if (!typeLabel) return translated;

  // Many ComfyUI nodes expose the internal key "samples" for LATENT sockets.
  // In the UI, users expect the visible socket label to stay as the socket type.
  if (itemName === "samples" && typeLabel === "Latent") {
    return "Latent";
  }

  if (/^output_\d+$/.test(itemName) && !translated) {
    return typeLabel;
  }

  return translated;
}

function resolveInputTranslation(TUtils, translation, item) {
  for (const key of getLookupKeys(item)) {
    const translated = TUtils.getInputTranslationDict(translation, key);
    if (translated) return applySocketTypeFallback(item, translated);
  }
  return applySocketTypeFallback(item, null);
}

function resolveOutputTranslation(TUtils, translation, item) {
  for (const key of getLookupKeys(item)) {
    const translated = TUtils.getOutputTranslation(translation, key);
    if (translated) return applySocketTypeFallback(item, translated);
  }
  return applySocketTypeFallback(item, null);
}

function resolveWidgetTranslation(TUtils, translation, item) {
  const widgetT = translation.widgets || {};

  for (const key of getLookupKeys(item)) {
    const translated =
      TUtils.getTranslationFromMap(widgetT, key, true) ||
      TUtils.getWidgetTranslationDict(translation, key);
    if (translated) return translated;
  }

  return null;
}

function setItemText(item, text) {
  if (!text || !item) return;
  if (!needsTranslation(item)) return;

  if (!item._dd_original_label) {
    item._dd_original_label =
      (typeof item.label === "string" && item.label) || item.name;
  }
  if (!item._original_name) {
    item._original_name = item.name;
  }

  item.label = text;
  if ("localized_name" in item || item.type === "combo") {
    item.localized_name = text;
  }
}

function restoreOriginalTranslation(item) {
  const originalLabel = item._dd_original_label || item._original_name;
  if (originalLabel) {
    item.label = originalLabel;
    delete item._dd_original_label;
    delete item._original_name;
  } else if (item.label && item.name) {
    item.label = item.name;
  }
}

function getPreservedTitleSuffix(originalTitle) {
  if (typeof originalTitle !== "string" || !originalTitle) return "";

  const suffixMatch = originalTitle.match(/\s*\(([^)]+)\)\s*$/);
  if (!suffixMatch) return "";

  const suffixText = String(suffixMatch[1] || "").trim().toLowerCase();

  // 仅保留少数有明确语义的标题后缀，避免把插件来源后缀（如 rgthree）重新拼回翻译标题。
  if (suffixText === "positive" || suffixText === "negative") {
    return suffixMatch[0];
  }

  return "";
}

function installNodeRuntimeHooks(node, deps = {}) {
  const { TUtils } = deps;
  if (!node || node._dd_translation_hooks_installed) return;

  const originalAddInput = node.addInput;
  if (typeof originalAddInput === "function") {
    node.addInput = function(name, type, extraInfo) {
      const oldInputs = [];
      if (Array.isArray(this.inputs)) {
        this.inputs.forEach((input) => oldInputs.push(input.name));
      }

      const result = originalAddInput.apply(this, arguments);
      if (Array.isArray(this.inputs)) {
        this.inputs.forEach((input) => {
          if (oldInputs.includes(input.name)) return;
          const classType = this.constructor.comfyClass || this.constructor.type || this.type;
          const currentTranslation = TUtils.getNodeConfigForClassType(classType) || {};
          const translated = resolveInputTranslation(TUtils, currentTranslation, input);
          if (translated) setItemText(input, translated);
        });
      }
      return result;
    };
  }

  const originalOnInputAdded = node.onInputAdded;
  node.onInputAdded = function(slot) {
    let result;
    if (typeof originalOnInputAdded === "function") {
      result = originalOnInputAdded.apply(this, arguments);
    }

    const classType = this.constructor.comfyClass || this.constructor.type || this.type;
    const nodeTranslation = TUtils.getNodeConfigForClassType(classType) || {};
    const translated = resolveInputTranslation(TUtils, nodeTranslation, slot);
    if (translated) setItemText(slot, translated);
    return result;
  };

  const originalAddOutput = node.addOutput;
  if (typeof originalAddOutput === "function") {
    node.addOutput = function(name, type, extraInfo) {
      const oldOutputs = [];
      if (Array.isArray(this.outputs)) {
        this.outputs.forEach((output) => oldOutputs.push(output.name));
      }

      const result = originalAddOutput.apply(this, arguments);
      if (Array.isArray(this.outputs)) {
        this.outputs.forEach((output) => {
          if (oldOutputs.includes(output.name)) return;
          const classType = this.constructor.comfyClass || this.constructor.type || this.type;
          const currentTranslation = TUtils.getNodeConfigForClassType(classType) || {};
          const translated = resolveOutputTranslation(TUtils, currentTranslation, output);
          if (translated) setItemText(output, translated);
        });
      }
      return result;
    };
  }

  const originalAddWidget = node.addWidget;
  if (typeof originalAddWidget === "function") {
    node.addWidget = function(type, name, value, callback, options) {
      const result = originalAddWidget.apply(this, arguments);
      if (result) {
        const classType = this.constructor.comfyClass || this.constructor.type || this.type;
        const currentTranslation = TUtils.getNodeConfigForClassType(classType) || {};
        const translated = resolveWidgetTranslation(TUtils, currentTranslation, result);
        if (translated) setItemText(result, translated);
      }
      return result;
    };
  }

  node._dd_translation_hooks_installed = true;
}

export function applyNodeTranslation(node, deps = {}) {
  const { TUtils } = deps;

  try {
    if (!node || !node.constructor) {
      return;
    }

    const keys = ["inputs", "outputs", "widgets"];
    let classType = node.constructor.comfyClass || node.constructor.type || node.type;
    if (!classType) {
      classType = node.constructor.name;
    }
    if (!classType) {
      return;
    }

    if (!isTranslationEnabled()) {
      for (const key of keys) {
        if (!Array.isArray(node[key])) continue;
        node[key].forEach((item) => {
          if (item?._dd_original_label || item?._original_name) {
            restoreOriginalTranslation(item);
          }
        });
      }

      if (node._original_title && !node._dd_custom_title) {
        node.title = node._original_title;
        node.constructor.title = node._original_title;
        delete node._original_title;
      }
      return;
    }

    const translation =
      TUtils.getNodeConfigForClassType(classType) ||
      TUtils.getNodeConfigForClassType(node?.title) ||
      TUtils.getNodeConfigForClassType(node?.constructor?.title) ||
      {};

    if (translation.title && !hasNativeTranslation(node, "title")) {
      if (!node._original_title) node._original_title = node.title || classType;
      const suffix = getPreservedTitleSuffix(node._original_title);
      node.title = translation.title + suffix;
    }

    for (const key of keys) {
      if (!Array.isArray(node[key])) continue;
      node[key].forEach((item) => {
        if (!item?.name) return;
        const hasNative = hasNativeTranslation(item, "label") && !item._original_name;
        if (hasNative) return;

        if (key === "inputs" || key === "widgets") {
          let translated = null;
          if (key === "widgets") {
            translated = resolveWidgetTranslation(TUtils, translation, item);
          } else {
            translated = resolveInputTranslation(TUtils, translation, item);
          }
          if (translated) setItemText(item, translated);
        } else if (key === "outputs") {
          const translated = resolveOutputTranslation(TUtils, translation, item);
          if (translated) setItemText(item, translated);
        }
      });
    }

    installNodeRuntimeHooks(node, deps);
  } catch (e) {
    error(`为节点 ${node?.title || "未知"} 应用翻译失败:`, e);
  }
}
