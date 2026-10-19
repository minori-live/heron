---
title: Heron Repitch
description: 使用 Heron Repitch 做音高变换：基于 Rubber Band LiveShifter，带干湿混合。
vstTrademark: true
---

# Heron Repitch

Heron Repitch 是基于 Rubber Band LiveShifter 的实时音高变换插件。
编辑器布局与 Heron Revox 同类：半音与音分、共振峰保持、音质选择，以及干湿混合。

Heron Studio 已内置 Heron Repitch，无需另行安装即可加载。在其他 DAW 中使用时，
请从[插件发布版本](../releases.md)安装。

## 开始使用

1. 在其他 DAW 中，按操作系统与宿主支持的格式[安装 Heron 插件](../releases.md)。
   在 Heron Studio 中，该效果已经随应用提供。
2. 重新启动 DAW，必要时重新扫描插件目录。
3. 将 **Heron Repitch** 添加为音频效果，并打开编辑器。

支持的声道布局为单声道与立体声。

## 控件

| 控件      | 范围            | 作用                                                                |
| --------- | --------------- | ------------------------------------------------------------------- |
| Semitones | −12 至 +12      | 以半音为单位的粗调音高。默认值为 0。                                |
| Cents     | −100 至 +100    | 加在 Semitones 上的细调音高。默认值为 0。                           |
| Formant   | 开或关          | 变调时保持共振峰。默认开启。                                        |
| Quality   | Faster 或 Finer | 实时变调的窗口取舍。默认是 Finer。                                  |
| Mix       | 0% 至 100%      | 干湿混合。0% 为已按延迟对齐的干声，100% 为完全湿声。默认值为 100%。 |

## 延迟

Heron 按插件上报的延迟做补偿。Repitch 上报的是当前音质与音高下
Rubber Band LiveShifter 的起始延迟（`getStartDelay()`）。
Semitones、Cents 或 Quality 变化时，这个上报值可能改变。
Heron 不会用另一套公式替换它。

## 相关页面

- [插件发布版本](../releases.md)
- [插件手册概览](index.md)
- [Heron Studio 中的 VST 3 插件](../../manual/plugins.md)
