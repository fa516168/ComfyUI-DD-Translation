export function installCanvasWidgetTranslation(deps = {}) {
  const {
    LGraphCanvas,
    TUtils,
    isTranslationEnabled,
    error,
    createWidgetDrawTextTranslator,
  } = deps;

  try {
    const originalDrawNodeWidgets = LGraphCanvas?.prototype?.drawNodeWidgets;
    if (!originalDrawNodeWidgets || originalDrawNodeWidgets._dd_hooked) return false;

    const nodeWidgetTranslatorCache = new WeakMap();
    const nodeTranslationCache = new Map();

    const getNodeTranslation = (classType) => {
      if (!classType) return {};
      if (nodeTranslationCache.has(classType)) {
        return nodeTranslationCache.get(classType);
      }

      const translation = TUtils.getNodeConfigForClassType(classType) || {};
      nodeTranslationCache.set(classType, translation);
      return translation;
    };

    const getWidgetCacheSignature = (widgets) => {
      if (!Array.isArray(widgets) || widgets.length === 0) return "";

      return widgets.map((widget) => {
        const name = widget?.name ?? "";
        const type = widget?.type ?? "";
        const value = widget?.value;
        const simpleValue =
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : "";
        const toggleOn = widget?.options?.hasOwnProperty("on") ? String(widget.options.on) : "";
        const toggleOff = widget?.options?.hasOwnProperty("off") ? String(widget.options.off) : "";

        return `${name}|${type}|${simpleValue}|${toggleOn}|${toggleOff}`;
      }).join("||");
    };

    const getCachedTranslateDrawnText = (node, menuT, nodeTranslation) => {
      const widgets = node?.widgets;
      const signature = getWidgetCacheSignature(widgets);
      const cached = nodeWidgetTranslatorCache.get(node);

      if (
        cached &&
        cached.menuT === menuT &&
        cached.nodeTranslation === nodeTranslation &&
        cached.signature === signature
      ) {
        return cached.translateDrawnText;
      }

      const getWidgetNameTranslation = (widget) => {
        if (!widget || typeof widget.name !== "string") return null;
        const rawName = widget.name.trim();
        if (!rawName) return null;

        const widgetT = nodeTranslation?.widgets || {};
        return (
          TUtils.getTranslationFromMap(widgetT, rawName, true) ||
          null
        );
      };

      const widgetNameSet = new Set(
        Array.isArray(widgets)
          ? widgets
              .map((w) => (typeof w?.name === "string" ? w.name.trim().toLowerCase() : ""))
              .filter(Boolean)
          : []
      );

      const translateDrawnText = createWidgetDrawTextTranslator(widgets, {
        menuTranslations: menuT,
        getWidgetNameTranslation,
        lookupMenuTranslation: (text) => TUtils.getTranslationFromMap(menuT, text, false),
        getMenuTranslation: (text) => {
          if (typeof text !== "string") return null;
          const trimmed = text.trim();
          if (!trimmed) return null;
          if (widgetNameSet.has(trimmed.toLowerCase())) return null;
          return TUtils.getTranslationFromMap(menuT, trimmed, false);
        },
      });

      nodeWidgetTranslatorCache.set(node, {
        menuT,
        nodeTranslation,
        signature,
        translateDrawnText,
      });

      return translateDrawnText;
    };

    LGraphCanvas.prototype.drawNodeWidgets = function(node, posY, ctx, active_widget) {
      if (!isTranslationEnabled() || !TUtils.T?.Menu || !node || !node.widgets) {
        return originalDrawNodeWidgets.apply(this, arguments);
      }

      const menuT = TUtils.T.Menu;
      const classType = node?.constructor?.comfyClass || node?.constructor?.type || node?.type;
      const nodeTranslation = getNodeTranslation(classType);

      let originalMeasureText = null;
      let originalFillText = null;
      let originalStrokeText = null;

      try {
        const translateDrawnText = getCachedTranslateDrawnText(node, menuT, nodeTranslation);

        originalMeasureText = ctx.measureText;
        originalFillText = ctx.fillText;
        originalStrokeText = ctx.strokeText;

        ctx.measureText = function(text) {
          return originalMeasureText.call(this, translateDrawnText(text));
        };
        ctx.fillText = function(text, x, y, maxWidth) {
          return originalFillText.call(this, translateDrawnText(text), x, y, maxWidth);
        };
        ctx.strokeText = function(text, x, y, maxWidth) {
          return originalStrokeText.call(this, translateDrawnText(text), x, y, maxWidth);
        };

        return originalDrawNodeWidgets.apply(this, arguments);
      } catch (err) {
        error("组件翻译绘制过程中出错:", err);
        return originalDrawNodeWidgets.apply(this, arguments);
      } finally {
        if (ctx && typeof ctx === "object") {
          if (originalMeasureText) ctx.measureText = originalMeasureText;
          if (originalFillText) ctx.fillText = originalFillText;
          if (originalStrokeText) ctx.strokeText = originalStrokeText;
        }
      }
    };

    LGraphCanvas.prototype.drawNodeWidgets._dd_hooked = true;
    return true;
  } catch (e) {
    error("全局组件绘制翻译拦截失败:", e);
    return false;
  }
}

export function installCanvasGroupTranslation(deps = {}) {
  const { LGraphCanvas, TUtils, isTranslationEnabled, error } = deps;

  try {
    const originalDrawGroups = LGraphCanvas?.prototype?.drawGroups;
    if (!originalDrawGroups || originalDrawGroups._dd_hooked) return false;

    let cachedGroupsMap = null;
    let cachedMenuMap = null;
    const groupTitleCache = new Map();

    const resolveGroupTitleTranslation = (title, groupsT, menuT) => {
      if (!title) return null;

      if (cachedGroupsMap !== groupsT || cachedMenuMap !== menuT) {
        cachedGroupsMap = groupsT;
        cachedMenuMap = menuT;
        groupTitleCache.clear();
      }

      if (groupTitleCache.has(title)) {
        return groupTitleCache.get(title);
      }

      const translation =
        TUtils.getTranslationFromMap(groupsT, title, false) ||
        TUtils.getTranslationFromMap(groupsT, title?.trim?.() || title, false) ||
        TUtils.getTranslationFromMap(menuT, title, false) ||
        null;

      groupTitleCache.set(title, translation);
      return translation;
    };

    LGraphCanvas.prototype.drawGroups = function(canvas, ctx) {
      if (!isTranslationEnabled() || !TUtils.T || !TUtils.T.Groups || !this.graph) {
        return originalDrawGroups.apply(this, arguments);
      }

      const groups = this.graph._groups;
      if (!groups) return originalDrawGroups.apply(this, arguments);

      const groupsT = TUtils.T.Groups;
      const menuT = TUtils.T.Menu || {};
      const restoredValues = new Map();

      try {
        for (const group of groups) {
          const title = group.title;
          const translation = resolveGroupTitleTranslation(title, groupsT, menuT);

          if (translation && translation !== title) {
            restoredValues.set(group, title);
            group.title = translation;
          }
        }

        return originalDrawGroups.apply(this, arguments);
      } catch (err) {
        error("组翻译绘制过程中出错:", err);
        return originalDrawGroups.apply(this, arguments);
      } finally {
        for (const [group, originalTitle] of restoredValues) {
          group.title = originalTitle;
        }
      }
    };

    LGraphCanvas.prototype.drawGroups._dd_hooked = true;
    return true;
  } catch (e) {
    error("全局组绘制翻译拦截失败:", e);
    return false;
  }
}

export function installCanvasTranslation(deps = {}) {
  installCanvasWidgetTranslation(deps);
  installCanvasGroupTranslation(deps);
}
