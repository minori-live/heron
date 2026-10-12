export interface EqFeature {
  title: string
  body: string
  crop: string
}

export interface EqCopy {
  tagline: string
  introTitle: string
  intro: string
  included: string
  download: string
  manual: string
  imageAlt: string
  enlarge: string
  featuresTitle: string
  features: EqFeature[]
  modesTitle: string
  modes: { name: string; body: string }[]
  specificationsTitle: string
  specifications: string[]
  startTitle: string
  startBody: string
}

export const eqCopy = {
  en: {
    tagline: "Find the shape of your sound",
    introTitle: "Your sound, in full view",
    intro:
      "A free, open-source parametric equalizer with up to 24 bands. Shape a broad tonal balance or focus on a single frequency, with an interactive EQ graph and a spectrum display that follows your audio.",
    included: "Included with Heron. Available as a separate plug-in for your favorite DAW.",
    download: "Download Heron EQ",
    manual: "Read the manual",
    imageAlt: "Heron EQ showing three EQ bands, input and output spectra, and band controls",
    enlarge: "View full-size screenshot",
    featuresTitle: "A closer look at your sound",
    features: [
      {
        title: "Shape it on the graph",
        body: "Double-click to add a band, drag to change its frequency and gain, and scroll to adjust Q. Select several bands to move them together, or enter an exact value in the floating controls.",
        crop: "490 820 1080 540"
      },
      {
        title: "See what you hear",
        body: "Follow the input, output, and routed sidechain spectra. Freeze a moment for a closer look, or use a sidechain reference to fit an EQ curve to its spectrum.",
        crop: "40 220 1400 700"
      },
      {
        title: "Work across the stereo field",
        body: "Choose Stereo, Left, Right, Mid, or Side for each band. Solo a band to hear your changes, then adjust output gain and balance with the signal in view.",
        crop: "1010 710 1050 525"
      }
    ],
    modesTitle: "Three ways to process",
    modes: [
      { name: "Zero latency", body: "Digital filters without added processing latency." },
      { name: "Natural phase", body: "Oversampled filtering for an alternative phase response." },
      { name: "Linear phase", body: "Linear-phase filtering with selectable resolution." }
    ],
    specificationsTitle: "The details that make a difference",
    specifications: [
      "Up to 24 EQ bands with individual bypass and solo",
      "Bell, shelf, cut, notch, band-pass, tilt, and all-pass filters",
      "Stereo, Left, Right, Mid, or Side processing per band",
      "Multiple-band selection and precise numeric entry",
      "Pre-EQ, post-EQ, and external sidechain spectrum display",
      "Spectrum freeze and frequency snapping to musical notes",
      "EQ matching to the current instance’s sidechain spectrum",
      "Copy and paste bands between instances",
      "Output gain, automatic gain, gain scale, and polarity",
      "Left/Right and Mid/Side output balance",
      "Input and output meters with peak readouts",
      "Settings saved and restored with your host session"
    ],
    startTitle: "Make room for your sound",
    startBody:
      "Add Heron EQ to an Audio FX slot in Heron, or download the plug-in for another compatible DAW."
  },
  zh: {
    tagline: "找到声音的形状",
    introTitle: "每次调整，清晰可见",
    intro:
      "一款自由、开源的参数均衡器，提供最多 24 个频段。从整体音色到单个频率，在交互式 EQ 图表上直接调整，用实时频谱观察声音的变化。",
    included: "Heron 已内置，也可独立安装到你常用的 DAW。",
    download: "下载 Heron EQ",
    manual: "阅读使用手册",
    imageAlt: "Heron EQ 界面：三个 EQ 频段、输入输出频谱与频段控件",
    enlarge: "查看完整截图",
    featuresTitle: "更细致地观察与塑造声音",
    features: [
      {
        title: "直接在图表上调整",
        body: "双击添加频段，拖动改变频率与增益，滚动调整 Q。多选频段可一起移动，也可以在浮动控件中输入精确数值。",
        crop: "490 820 1080 540"
      },
      {
        title: "看见你听到的变化",
        body: "同时观察输入、输出与已路由的侧链频谱。冻结频谱以仔细查看，或以侧链作为参考，拟合出对应的 EQ 曲线。",
        crop: "40 220 1400 700"
      },
      {
        title: "细调立体声中的每一部分",
        body: "为每个频段选择 Stereo、Left、Right、Mid 或 Side。独奏频段听清调整的部分，再结合电平显示设置输出增益与平衡。",
        crop: "1010 710 1050 525"
      }
    ],
    modesTitle: "三种处理模式",
    modes: [
      { name: "Zero latency", body: "数字滤波，不增加处理延迟。" },
      { name: "Natural phase", body: "通过过采样滤波，提供不同的相位响应。" },
      { name: "Linear phase", body: "线性相位滤波，可选择分辨率。" }
    ],
    specificationsTitle: "把细节留给声音",
    specifications: [
      "最多 24 个 EQ 频段，可分别旁通与独奏",
      "钟形、搁架、切除、陷波、带通、倾斜与全通滤波器",
      "每段独立选择 Stereo、Left、Right、Mid 或 Side",
      "多频段选择与精确数值输入",
      "输入、输出与外部侧链频谱显示",
      "频谱冻结，以及吸附到音符的频率调整",
      "将 EQ 拟合到当前实例的侧链频谱",
      "跨实例复制与粘贴频段",
      "输出增益、自动增益、增益缩放与极性反转",
      "Left/Right 与 Mid/Side 输出平衡",
      "输入输出电平表与峰值读数",
      "随宿主工程保存与恢复插件设置"
    ],
    startTitle: "为你的声音，找到合适的位置",
    startBody: "在 Heron 的音频效果插槽中添加 Heron EQ，或下载插件，在其他兼容 DAW 中使用。"
  }
} satisfies Record<"en" | "zh", EqCopy>
