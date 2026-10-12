export interface AnalysisFeature {
  title: string
  body: string
}

export interface AnalysisCopy {
  tagline: string
  introTitle: string
  intro: string
  included: string
  download: string
  manual: string
  enlarge: string
  imageAlt: string
  featuresTitle: string
  features: AnalysisFeature[]
  comparisonTitle: string
  comparisonBody: string
  fitTitle: string
  fitBody: string
  workflowTitle: string
  steps: AnalysisFeature[]
  detailsTitle: string
  details: string[]
  startTitle: string
  startBody: string
}

export const analysisCopy = {
  en: {
    tagline: "See how your plug-ins shape the sound",
    introTitle: "Explore the response behind the sound",
    intro:
      "Measure an effect on its own or study an entire chain. Plugin Analysis brings frequency response, phase, distortion, and processing performance into one workspace, with independent experiment chains that leave your project untouched.",
    included:
      "Built into Heron Studio. Open Help → Plugin Analysis… to start, with no project required.",
    download: "Download Heron Studio",
    manual: "Read the manual",
    enlarge: "View full-size screenshot",
    imageAlt:
      "Heron Studio Plugin Analysis window with effect-chain controls and measurement reports",
    featuresTitle: "A closer look at what changes",
    features: [
      {
        title: "Trace the response",
        body: "Inspect frequency response, phase, and impulse response to see how an effect changes the signal. Explore individual input-to-output paths in Left/Right or Mid/Side, and retain a reference curve for comparison."
      },
      {
        title: "Examine harmonics and nonlinear behavior",
        body: "Follow H2–H8, THD, and THD+N, then inspect the measured sweep spectrum, waveforms, and dynamics. A parallel Hammerstein approximation lets you compare a model’s prediction with an independently measured signal."
      },
      {
        title: "Measure the processing cost",
        body: "See average, P95, P99, and maximum processing time alongside reported latency and audio-budget use. Compare callback times across five block sizes to understand the chain’s CPU cost on your computer."
      }
    ],
    comparisonTitle: "Two chains, one set of conditions",
    comparisonBody:
      "Build two independent chains with up to 16 effects each. Overlay their reports to compare settings, plug-ins, or processing order, then inspect the actual output difference. The difference measurement preserves phase and latency offsets; it does not automatically align the chains.",
    fitTitle: "Turn a measured curve into EQ settings",
    fitBody:
      "Choose one measured magnitude path and set an EQ band limit from 1 to 24. EQ Fit finds a Bell and shelf approximation, shows its residual error, and exports bands for Heron EQ with a separate overall gain. The fit models magnitude only; it does not recreate the source plug-in’s phase, dynamics, nonlinear behavior, or channel routing.",
    workflowTitle: "From an effect to an answer",
    steps: [
      {
        title: "Build an experiment",
        body: "Add effects from the plug-in catalog, choose their audio modes, and open their editors. Reorder or bypass inserts to explore the chain."
      },
      {
        title: "Set the conditions",
        body: "Choose the input level, sample rate, block size, and measurement duration. Analyze once, repeat the measurement, or enable automatic analysis as you adjust settings."
      },
      {
        title: "Inspect and compare",
        body: "Explore the response and distortion reports, compare two chains, or fit a measured magnitude curve to a set of EQ bands."
      }
    ],
    detailsTitle: "More ways to investigate",
    details: [
      "Two independent chains with up to 16 effects per chain",
      "Frequency response, phase, and impulse response",
      "Left/Right and Mid/Side input-to-output paths",
      "H2–H8 harmonics, THD, THD+N, and two-tone intermodulation",
      "Measured 2D sweep spectrum and waveform captures",
      "Dynamics transfer curves and attack/release envelopes",
      "Parallel Hammerstein approximation with independent validation",
      "Processing-time statistics at 64, 128, 256, 512, and 1024 samples",
      "Sweep input levels from −60 to +12 dBFS peak",
      "Sweep, impulse, or white-noise linear measurements",
      "Automatic analysis after edits and repeat measurements",
      "EQ Fit with a 1–24 band limit and Heron EQ band export"
    ],
    startTitle: "Get to know your effects",
    startBody:
      "Open Help → Plugin Analysis… in Heron Studio, add an effect, and make your first measurement. The independent analysis window is ready even before you open a project."
  },
  zh: {
    tagline: "看清插件如何改变声音",
    introTitle: "从声音变化，看到实际响应",
    intro:
      "测量一个效果器，也可以研究整条效果链。Plugin Analysis 将频响、相位、失真与处理性能放在同一个工作区，用独立的实验链探索插件，不改变工程中的设置。",
    included: "Heron Studio 已内置。从帮助 → Plugin Analysis… 打开，无需先创建或打开工程。",
    download: "下载 Heron Studio",
    manual: "阅读使用手册",
    enlarge: "查看完整截图",
    imageAlt: "Heron Studio 的 Plugin Analysis 窗口，展示效果链控件与测量报告",
    featuresTitle: "从不同角度观察声音变化",
    features: [
      {
        title: "看清频响与相位",
        body: "通过频率响应、相位与脉冲响应，观察效果器如何改变信号。分别查看 Left/Right 或 Mid/Side 的输入输出路径，也可以保留参考曲线进行对比。"
      },
      {
        title: "观察泛音与非线性行为",
        body: "查看 H2–H8、THD 与 THD+N，再结合实测扫频频谱、波形和动态响应了解变化。通过并联 Hammerstein 近似，还能将模型预测与独立实测信号进行比较。"
      },
      {
        title: "测量处理开销",
        body: "查看平均、P95、P99 与最大处理耗时，以及插件报告的延迟和音频预算占用。比较五种处理块大小下的回调耗时，了解效果链在当前电脑上的 CPU 开销。"
      }
    ],
    comparisonTitle: "相同条件下，比较两条效果链",
    comparisonBody:
      "搭建两条相互独立的效果链，每条最多容纳 16 个效果。叠加报告，比较参数、插件或处理顺序，再查看实际输出差分。差分测量会保留相位与延迟差异，不会自动对齐两条链的延迟。",
    fitTitle: "把实测曲线变成 EQ 参数",
    fitBody:
      "选择一条实测幅度路径，将 EQ 频段上限设为 1 至 24。EQ Fit 使用钟形与搁架滤波器进行近似，显示残差，并导出可用于 Heron EQ 的频段与单独的整体增益。拟合仅描述幅度，不会重建原插件的相位、动态、非线性行为或声道路由。",
    workflowTitle: "从一个效果器，开始一次实验",
    steps: [
      {
        title: "搭建实验链",
        body: "从插件目录添加效果，选择声道模式并打开编辑器。调整插入顺序或旁路效果，探索整条链的变化。"
      },
      {
        title: "设置测量条件",
        body: "选择输入电平、采样率、处理块大小与测量时长。手动测量、重复测量，或开启自动分析，随参数调整重新测量。"
      },
      {
        title: "观察并比较",
        body: "查看响应与失真报告，比较两条效果链，或将实测幅度曲线拟合为一组 EQ 频段。"
      }
    ],
    detailsTitle: "用更多测量理解声音",
    details: [
      "两条独立效果链，每条最多 16 个效果",
      "频率响应、相位与脉冲响应",
      "Left/Right 与 Mid/Side 输入输出路径",
      "H2–H8 泛音、THD、THD+N 与双音互调失真",
      "实测二维扫频频谱与波形采集",
      "动态传递曲线与启动／释放包络",
      "带独立验证的并联 Hammerstein 近似",
      "64、128、256、512 与 1024 采样下的处理耗时统计",
      "−60 至 +12 dBFS peak 的扫频输入电平",
      "扫频、脉冲或白噪声线性测量",
      "编辑后自动分析与重复测量",
      "1–24 段上限的 EQ Fit，可导出 Heron EQ 频段"
    ],
    startTitle: "从熟悉的插件开始探索",
    startBody:
      "在 Heron Studio 中打开帮助 → Plugin Analysis…，添加一个效果器，开始第一次测量。无需打开工程，即可使用独立的分析窗口。"
  }
} satisfies Record<"en" | "zh", AnalysisCopy>
