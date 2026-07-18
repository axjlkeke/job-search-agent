# Third-Party Notices

本项目的新版工作台使用或参考了以下开源项目。各项目的版权归原作者所有，具体授权条款以其仓库中的许可证文件为准。

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| [Studio Admin](https://github.com/alone-djang/studio-admin) | 工作台的信息层级与导航视觉参考；本项目未直接复制其完整界面代码 | MIT |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | AI 对话界面基础组件 | MIT |
| [Phosphor Icons](https://github.com/phosphor-icons/react) | 工作台图标 | MIT |
| [Daria Glakteeva / Unsplash](https://unsplash.com/photos/a-person-typing-on-a-laptop-on-a-desk-2w0IdiEI-hg) | 个性化总览的黑白纪实背景图片 | Unsplash License |
| [Valentin Zickner / Unsplash](https://unsplash.com/photos/train-tracks-leading-into-the-distance-under-clear-sky-sTUthBj8bNA) | 目标路线的黑白铁轨背景图片 | Unsplash License |
| [Fabian Fauth / Unsplash](https://unsplash.com/photos/spiral-staircase-RiWvn39cZSQ) | 学生档案页的黑白楼梯背景图片 | Unsplash License |
| [khanh nguyen / Unsplash](https://unsplash.com/photos/train-station-with-city-buildings-in-the-background-dRiQjnmj0T8) | 岗位页的黑白城市轨道背景图片 | Unsplash License |
| [Shahabudin Ibragimov / Unsplash](https://unsplash.com/photos/lights-illuminate-a-librarys-bookshelves-in-monochrome-JTG3le5xYl0) | AI 顾问页的黑白知识空间背景图片 | Unsplash License |
| [FastAPI](https://github.com/fastapi/fastapi) | 本地知识库检索与来源管理接口 | MIT |
| [Dify 1.15.0](https://github.com/langgenius/dify/tree/1.15.0) | 单工作区的 Agent / Chatflow 编排与知识库索引 | 修改版 Apache 2.0，含附加条件 |
| [Qdrant](https://github.com/qdrant/qdrant) | Dify 的向量检索存储 | Apache 2.0 |
| [Ollama](https://github.com/ollama/ollama) | Mac mini 本地向量与对话模型运行时 | MIT |
| [Qwen2.5 1.5B Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) | Mac mini 本地对话与求职规划模型 | Apache 2.0 |
| [Qwen3 Embedding 0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) | 知识库文档与查询的向量化模型 | Apache 2.0 |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | Mac mini 图片型招聘公告文字识别 | Apache 2.0 |
| [tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) | Tesseract 简体中文 OCR 模型 `chi_sim.traineddata` | Apache 2.0 |

完整的第三方许可证文本可从上述对应仓库查阅。

Apple Vision OCR 由 macOS 系统框架提供，本项目只编译自己的轻量调用程序，不分发 Apple 框架或模型；非 macOS 环境自动使用上表中的 Tesseract 兜底。

Dify 当前只作为本项目的单工作区后端使用，不开放 Dify 自带前端，也不为每个学生创建 Dify workspace。若未来把 Dify 本身做成多租户服务，需先重新核对其附加许可条件或取得商业授权。
