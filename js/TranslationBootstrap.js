import { applyMenuTranslation, installContextMenuTranslation } from "./MenuTranslate.js";
import { installCanvasTranslation } from "./CanvasTranslateInstaller.js";
import { addRegisterNodeDefCallback, applyNodeTypeTranslation } from "./NodeDefinitionTranslation.js";
import { applyNodeTranslation } from "./NodeInstanceTranslation.js";
import { installTopbarStatusTranslation, installTopbarTranslation } from "./TopbarTranslateInstaller.js";
import { applyVueI18nNodeDefs } from "./VueNodeTranslation.js";

export function runTranslationInit(app, deps = {}) {
  const { TUtils, isTranslationEnabled, error } = deps;

  try {
    if (!isTranslationEnabled()) return;

    const nodes = app?.graph?._nodes;
    if (nodes && nodes.length > 0) {
      nodes.forEach((node) => {
        applyNodeTranslation(node, { TUtils });
      });
      app.canvas?.draw?.(true, true);
    }

    installTopbarStatusTranslation({ TUtils, isTranslationEnabled, error });
  } catch (e) {
    error("初始化阶段应用翻译失败:", e);
  }
}

export function installTranslationFeatures(app, deps = {}) {
  const {
    TUtils,
    LiteGraph,
    LGraphCanvas,
    isTranslationEnabled,
    isVueNodes2,
    toggleTranslation,
    error,
    createWidgetDrawTextTranslator,
  } = deps;

  try {
    installTopbarTranslation({
      app,
      TUtils,
      isTranslationEnabled,
      toggleTranslation,
      error,
    });

    if (!isTranslationEnabled()) return;

    installCanvasTranslation({
      LGraphCanvas,
      TUtils,
      isTranslationEnabled,
      error,
      createWidgetDrawTextTranslator,
    });

    installContextMenuTranslation(LiteGraph, {
      menuTranslations: TUtils.T.Menu,
      getNodeTitle: (classType) => TUtils.getNodeConfigForClassType(classType)?.title || null,
      getMenuTranslation: (key) => TUtils.getTranslationFromMap(TUtils.T.Menu, key, false),
    });

    if (!isVueNodes2()) {
      applyNodeTypeTranslation(app, { TUtils, LiteGraph });
      addRegisterNodeDefCallback(app, { TUtils, LiteGraph });
      return;
    }

    const isComfyUIChineseNative = document.documentElement.lang === "zh-CN";
    if (!isComfyUIChineseNative) {
      applyMenuTranslation(TUtils.T);
    }
    applyVueI18nNodeDefs({ TUtils });
  } catch (e) {
    error("安装翻译功能失败:", e);
  }
}
