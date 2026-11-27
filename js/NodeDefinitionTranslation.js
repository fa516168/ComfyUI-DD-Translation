import { error, hasNativeTranslation, isTranslationEnabled } from "./utils.js";

/**
 * ComfyUI 官方前端对“纯前端注册、未提供 description”的节点会自动合成说明：
 * `Frontend only node for <节点类型>`（见前端 updateVueAppNodeDefs）。
 * 这类说明不在任何源码/翻译表里，只能按模板在运行时翻译。
 */
const FRONTEND_ONLY_DESC_PATTERN = /^Frontend only node for (.+)$/;

function translateSyntheticFrontendDescription(nodeData, translation) {
  if (!nodeData || typeof nodeData.description !== "string") return;
  const match = nodeData.description.match(FRONTEND_ONLY_DESC_PATTERN);
  if (!match) return;
  const rawType = (match[1] || "").trim();
  const titleTranslation = translation?.title;
  nodeData.description = `前端专用节点：${titleTranslation || rawType}`;
}

export function applyNodeTypeTranslationEx(nodeName, deps = {}) {
  const { TUtils, LiteGraph } = deps;

  try {
    const nodeType = LiteGraph?.registered_node_types?.[nodeName];
    if (!nodeType) return;

    const classType = nodeType.comfyClass ? nodeType.comfyClass : nodeType.type;
    const translation = TUtils.getNodeConfigForClassType(classType);
    if (translation?.title && !hasNativeTranslation(nodeType, "title")) {
      nodeType.title = translation.title;
    }
  } catch (e) {
    error(`为节点类型 ${nodeName} 应用翻译失败:`, e);
  }
}

export function applyNodeTypeTranslation(app, deps = {}) {
  const { LiteGraph } = deps;

  try {
    if (!isTranslationEnabled()) return;

    for (const nodeName in LiteGraph?.registered_node_types || {}) {
      applyNodeTypeTranslationEx(nodeName, deps);
    }
  } catch (e) {
    error("应用节点类型翻译失败:", e);
  }
}

export function applyNodeDescTranslation(nodeType, nodeData, app, deps = {}) {
  const { TUtils } = deps;

  try {
    if (!isTranslationEnabled()) {
      return;
    }

    const translation = TUtils.getNodeConfigForClassType(nodeType?.comfyClass);
    if (translation?.description) {
      nodeData.description = translation.description;
    } else {
      translateSyntheticFrontendDescription(nodeData, translation);
    }

    if (!translation) return;

    const nodeInputT = translation.inputs || {};
    const nodeWidgetT = translation.widgets || {};
    const nodeTooltipT = translation.tooltips || {};

    for (const inputType in nodeData.input) {
      for (const socketName in nodeData.input[inputType]) {
        const inputEntry = nodeData.input[inputType][socketName];
        const tooltipTr = TUtils.getTranslationFromMap(nodeTooltipT, socketName, true);
        if (tooltipTr) {
          if (inputEntry[1] === undefined) inputEntry[1] = {};
          inputEntry[1].tooltip = tooltipTr;
          continue;
        }

        if (inputEntry[1] === undefined || !inputEntry[1].tooltip) continue;
        const tooltip = inputEntry[1].tooltip;
        const translatedTooltip =
          TUtils.getTranslationFromMap(nodeTooltipT, tooltip, true) ||
          tooltip;
        inputEntry[1].tooltip = translatedTooltip;
      }
    }

    const nodeOutputT = translation.outputs || {};
    if (nodeData.output_tooltips && Array.isArray(nodeData.output_tooltips)) {
      const newTooltips = [...nodeData.output_tooltips];
      for (let index = 0; index < newTooltips.length; index++) {
        const tooltip = newTooltips[index];
        const outputName = nodeData.output_name ? nodeData.output_name[index] : null;
        const tooltipTr = outputName ? TUtils.getTranslationFromMap(nodeTooltipT, outputName, true) : null;
        if (tooltipTr) {
          newTooltips[index] = tooltipTr;
          continue;
        }

        const translatedTooltip = TUtils.getTranslationFromMap(nodeOutputT, tooltip, true) || tooltip;
        newTooltips[index] = translatedTooltip;
      }
      nodeData.output_tooltips = newTooltips;
    }
  } catch (e) {
    error(`为节点 ${nodeType?.comfyClass || "未知"} 应用描述翻译失败:`, e);
  }
}

export function addRegisterNodeDefCallback(app, deps = {}) {
  try {
    if (!app || typeof app.registerNodeDef !== "function") return;
    if (app.registerNodeDef._dd_translation_hooked) return;

    const originalRegisterNodeDef = app.registerNodeDef;
    app.registerNodeDef = async function(nodeId, nodeData) {
      const result = originalRegisterNodeDef.apply(this, arguments);
      Promise.resolve(result).then(() => {
        applyNodeTypeTranslationEx(nodeId, deps);
      });
      return result;
    };

    app.registerNodeDef._dd_translation_hooked = true;
  } catch (e) {
    error("添加节点定义注册回调失败:", e);
  }
}
