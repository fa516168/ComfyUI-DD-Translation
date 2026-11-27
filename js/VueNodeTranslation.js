import {
  containsChineseCharacters,
  error,
  hasNativeTranslation,
  isTranslationEnabled,
  isVueNodes2,
} from "./utils.js";

export function applyVueNodeDisplayNameTranslation(nodeDef, deps = {}) {
  const { TUtils } = deps;

  try {
    const classType = nodeDef?.name;
    const translation =
      TUtils.getNodeConfigForClassType(classType) ||
      TUtils.getNodeConfigForClassType(nodeDef?.display_name) ||
      TUtils.getNodeConfigForClassType(nodeDef?.displayName);

    if (translation?.title && !hasNativeTranslation(nodeDef, "display_name")) {
      nodeDef.display_name = translation.title;
    }
  } catch (e) {
    error(`为Vue节点 ${nodeDef?.name} 应用显示名称翻译失败:`, e);
  }
}

export function applyVueNodeTranslation(nodeDef, deps = {}) {
  const { TUtils } = deps;

  try {
    const categoryTranslations = TUtils.T.NodeCategory;
    if (!nodeDef?.category) return;

    const categoryParts = nodeDef.category.split("/");
    nodeDef.category = categoryParts
      .map((category) => TUtils.getTranslationFromMap(categoryTranslations, category, false) || category)
      .join("/");
  } catch (e) {
    error(`为Vue节点 ${nodeDef?.name} 应用翻译失败:`, e);
  }
}

export function applyVueNodeDefTranslation(nodeDef, deps = {}) {
  const { TUtils } = deps;

  try {
    const classType = nodeDef?.name;
    const translation = TUtils.getNodeConfigForClassType(classType) || {};

    const translateInputs = (inputObject) => {
      if (!inputObject) return;

      for (const key in inputObject) {
        const translated = TUtils.getInputTranslationDict(translation, key);
        if (!translated) continue;

        const value = inputObject[key];
        if (Array.isArray(value) && value.length > 1 && typeof value[1] === "object") {
          if (!value[1].label || !containsChineseCharacters(value[1].label)) {
            value[1].label = translated;
          }
        }
      }
    };

    if (nodeDef.input) {
      translateInputs(nodeDef.input.required);
      translateInputs(nodeDef.input.optional);
    }

    if (translation.outputs && Array.isArray(nodeDef.output_name)) {
      for (let index = 0; index < nodeDef.output_name.length; index++) {
        const originalName = nodeDef.output_name[index];
        const translated = TUtils.getOutputTranslation(translation, originalName);
        if (translated && !containsChineseCharacters(originalName)) {
          nodeDef.output_name[index] = translated;
        }
      }
    }

    // 说明文字：优先用翻译表里的 description；否则处理 ComfyUI 官方为纯前端节点
    // 自动合成的 “Frontend only node for X” 说明（这类说明不在任何文件里，只能运行时翻译）。
    if (typeof nodeDef?.description === "string") {
      if (translation?.description) {
        nodeDef.description = translation.description;
      } else {
        const syntheticMatch = nodeDef.description.match(/^Frontend only node for (.+)$/);
        if (syntheticMatch) {
          const rawType = (syntheticMatch[1] || "").trim();
          nodeDef.description = `前端专用节点：${translation?.title || rawType}`;
        }
      }
    }
  } catch (e) {
    error(`Vue节点定义翻译注入失败 (${nodeDef?.name}):`, e);
  }
}

export function applyVueI18nNodeDefs(deps = {}) {
  const { TUtils } = deps;

  try {
    if (!isTranslationEnabled()) return;
    if (!isVueNodes2()) return;

    const api = window.comfyAPI?.i18n;
    if (!api || typeof api.addTranslations !== "function") return;

    const payloadNodeDefs = { nodeDefs: {} };
    const payloadFlat = {};
    const nodesT = TUtils.T.Nodes || {};

    for (const classType in nodesT) {
      const translation = nodesT[classType];
      const entry = {};

      if (translation?.title) entry.display_name = translation.title;

      const inputs = {};
      if (translation?.inputs) {
        for (const key in translation.inputs) {
          const name = translation.inputs[key];
          if (name) inputs[key] = { name };
        }
      }

      if (translation?.widgets) {
        for (const key in translation.widgets) {
          const name = translation.widgets[key];
          if (name && !inputs[key]) inputs[key] = { name };
        }
      }

      const outputs = {};
      if (translation?.outputs) {
        for (const key in translation.outputs) {
          const name = translation.outputs[key];
          if (name) outputs[key] = name;
        }
        if (translation.outputs.samples && !outputs.denoised_samples) {
          outputs.denoised_samples = translation.outputs.samples;
        }
      }

      if (Object.keys(inputs).length) entry.inputs = inputs;
      if (Object.keys(outputs).length) entry.outputs = outputs;

      if (Object.keys(entry).length) {
        payloadNodeDefs.nodeDefs[classType] = entry;
        payloadFlat[classType] = entry;
      }
    }

    api.addTranslations("zh-CN", payloadNodeDefs);
    api.addTranslations("zh", payloadNodeDefs);
    api.addTranslations("zh-cn", payloadNodeDefs);
    api.addTranslations("zh-CN", payloadFlat);
    api.addTranslations("zh", payloadFlat);
    api.addTranslations("zh-cn", payloadFlat);
  } catch (e) {
    error("注入Vue节点定义翻译失败:", e);
  }
}
