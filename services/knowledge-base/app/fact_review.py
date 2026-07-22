from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit


_DATE_PATTERN = re.compile(
    r"(?P<year>20\d{2})\s*[年./-]\s*(?P<month>1[0-2]|0?[1-9])"
    r"\s*[月./-]\s*(?P<day>3[01]|[12]\d|0?[1-9])\s*日?"
)
_MONTH_DAY_PATTERN = re.compile(
    r"(?P<month>1[0-2]|0?[1-9])\s*月\s*"
    r"(?P<day>3[01]|[12]\d|0?[1-9])\s*日"
)
_SENTENCE_PATTERN = re.compile(r"[^。！？；;\n]{1,220}[。！？；;]?", re.MULTILINE)
_DEADLINE_CONTEXT = re.compile(
    r"截止|报名(?:时间|日期|期限)|网申(?:时间|日期|期限)|"
    r"申请(?:时间|日期|期限)|投递(?:时间|日期|期限)"
)
_SINGLE_DAY_DEADLINE_CONTEXT = re.compile(
    r"截止|(?:报名|网申|申请|投递)日期|期限"
)
_DEADLINE_CLAUSE_SPLIT = re.compile(r"[,，]")
_TIME_AFTER_DATE = re.compile(
    r"^\s*(?P<hour>[01]?\d|2[0-3])"
    r"(?:(?:[:：](?P<colon_minute>[0-5]\d))|"
    r"(?:时(?P<hour_minute>[0-5]\d)?分?))"
)
_RANGE_CONTEXT = re.compile(r"至|到|—|–|~|～")
_GRADUATION_CONTEXT = re.compile(r"应届|毕业|校园招聘|校招")
_GRADUATION_YEAR = re.compile(
    r"(?P<first>20\d{2})"
    r"(?:\s*[-—–至到]\s*(?P<second>20\d{2}))?"
    r"\s*届"
)
_GRADUATION_DATE_CONTEXT = re.compile(
    r"毕业证(?:书)?(?:时间|日期)?|毕业时间|毕业日期|"
    r"取得(?:毕业证(?:书)?|学位证(?:书)?|学历学位证书|证书)|"
    r"学历(?:学位)?认证|学位认证|留服认证|留学服务中心认证"
)
_GRADUATION_CERTIFICATION_CONTEXT = re.compile(
    r"学历(?:学位)?认证|学位认证|留服认证|留学服务中心认证"
)
_GRADUATION_CLAUSE_SPLIT = re.compile(
    r"[,，]|(?=并(?:须|应)?(?:于|在)?\s*20\d{2}\s*[年./-])"
)
_RECRUITMENT_CONTEXT = re.compile(r"招聘|招录|报名|网申|投递|岗位|应聘")
_RECRUITMENT_AUDIENCE_CONTEXT = re.compile(
    r"招聘对象|招聘范围|招聘人群|应聘对象|招录对象|"
    r"面向|可报名|可以报名|均可报名|"
    r"社会公开招聘|校园招聘|校招|社会招聘|社招"
)
_UNEMPLOYED_GRADUATE = re.compile(
    r"(?:未落实工作单位|未就业|离校未就业|择业期内)"
    r"[^。！？；;\n]{0,24}毕业生|"
    r"毕业生[^。！？；;\n]{0,24}(?:未落实工作单位|未就业)"
)
_OVERSEAS_GRADUATE = re.compile(
    r"留学回国人员|留学人员|"
    r"国(?:[（(]境[）)])?外高校毕业生|境外高校毕业生"
)
_CURRENT_GRADUATE = re.compile(r"(?:高校)?应届(?:高校)?毕业生")
_COMBINED_GRADUATE = re.compile(r"应往届(?:高校)?毕业生")
_PREVIOUS_GRADUATE = re.compile(r"(?<!应)往届(?:高校)?毕业生")
_GENERAL_GRADUATE = re.compile(r"(?:20\d{2}届(?:高校)?|高校)毕业生")
_SYSTEM_BOTH_AUDIENCE = re.compile(
    r"系统内外人员|系统内\s*[、和及与/]\s*系统外人员|"
    r"系统内\s*[、/]\s*外人员"
)
_ASSESSMENT_SCHEDULE_CUE = re.compile(
    r"时间|日期|日程|安排|定于|初定|暂定|拟于|"
    r"计划于|预计|举行|组织"
)
_ASSESSMENT_EXCLUSION = re.compile(
    r"(?:大学)?英语(?:考试)?[四六]级|CET\s*[-－]?\s*[46]|"
    r"职业资格|执业资格|资格证|"
    r"考试成绩(?:查询|公布)|准考证|缴费",
    re.IGNORECASE,
)
_ASSESSMENT_EXPLICIT_RECRUITMENT = re.compile(
    r"招聘笔试|初选考试|统一笔试|招聘考试"
)
_ASSESSMENT_CLAUSE_SPLIT = re.compile(r"[,，]")
_DECIDED_PARTIAL_WITHDRAWAL = re.compile(
    r"决定"
    r"(?![^。；;\n]{0,16}(?:是否|不予|不再|暂不|不取消))"
    r"[^。；;\n]{0,80}?"
    r"(?:取消|核减|调减)"
    r"[^。；;\n]{0,40}?"
    r"(?:岗位|招聘计划|招聘人数)|"
    r"现予以[^。；;\n]{0,40}?"
    r"(?:取消|核减|调减)"
    r"[^。；;\n]{0,40}?"
    r"(?:岗位|招聘计划|招聘人数)|"
    r"现将[^。；;：:\n]{0,24}?"
    r"(?:取消|核减|调减)"
    r"[^。；;\n]{0,40}?"
    r"(?:岗位|招聘计划|招聘人数)|"
    r"(?:取消|核减|调减)\s*\d+\s*(?:个|名)?\s*"
    r"(?:招聘)?(?:岗位|计划|人数)"
)
_APPLIED_PARTIAL_WITHDRAWAL = re.compile(
    r"(?:招聘岗位|岗位情况|岗位调整情况|调整情况|备注)"
    r"\s*[：:]?\s*"
    r"(?:取消|核减|调减|减少)"
    r"[^。；;\n]{0,40}?"
    r"(?:岗位|招聘计划|招聘人数|招聘名额)"
)
_PARTIAL_WITHDRAWAL_TITLE = re.compile(
    r"(?:取消|核减|调减|减少)"
    r"[^。；;\n]{0,24}?"
    r"(?:岗位|招聘计划|招聘人数|招聘名额)|"
    r"(?:岗位|招聘计划|招聘人数|招聘名额)"
    r"[^。；;\n]{0,24}?"
    r"(?:取消|核减|调减|减少)"
)
_NEGATED_WITHDRAWAL = re.compile(r"(?:不予|不再|暂不|不)取消")
_APPLIED_CORRECTION = re.compile(
    r"(?:现|特)?(?:对|将)?"
    r"[^。；;\n]{0,30}?原公告"
    r"[^。；;\n]{0,30}?"
    r"(?:作出|进行|予以)?(?:更正|修订|调整)|"
    r"(?:更正|修订|调整)(?:内容)?如下|"
    r"(?:相关|其他)?事项?以本(?:公告|通知)为准"
)

_DEGREE_CONTEXT = re.compile(
    r"学历|学位|应聘资格|应聘要求|应聘条件|招聘条件|招聘要求|"
    r"任职要求|报名条件"
)
_DEGREE_PATTERNS = (
    ("专科", re.compile(r"(?:大专|专科)(?:及以上)?")),
    ("本科", re.compile(r"(?:大学)?本科(?:及以上)?")),
    (
        "硕士",
        re.compile(
            r"硕士(?:研究生)?(?:及以上)?|"
            r"(?<!博士)(?<!硕士)研究生(?:及以上)"
        ),
    ),
    ("博士", re.compile(r"博士(?:研究生)?(?:及以上)?")),
)
_APPLICATION_LIMIT_PATTERNS = (
    re.compile(r"每人[^。；;\n]{0,40}?(?:可|限)[^。；;\n]{0,20}?投递\s*(\d+)\s*个"),
    re.compile(r"每人[^。；;\n]{0,40}?仅有\s*(\d+)\s*次投递机会"),
    re.compile(r"每人[^。；;\n]{0,40}?最多[^。；;\n]{0,20}?投递\s*(\d+)\s*个"),
)
_AGE_VALUE = r"(?:1[6-9]|[2-6]\d|70)"
_AGE_GROUP = r"[\u3400-\u9fff（）()、及]{0,24}?"
_AGE_UPPER_PREFIX = re.compile(
    rf"(?P<label>{_AGE_GROUP})年龄(?:要求)?\s*[:：]?\s*"
    r"(?:一般)?\s*"
    r"(?P<operator>不超过|不高于|不得超过|不能超过|不满|未满|"
    r"上限(?:为)?|可?放宽(?:至|到))\s*"
    rf"(?P<age>{_AGE_VALUE})\s*周?岁"
)
_AGE_UPPER_SUFFIX = re.compile(
    rf"(?P<label>{_AGE_GROUP})年龄(?:要求)?\s*[:：]?\s*"
    r"(?:一般)?\s*(?:须|应|应当)?\s*(?:为|在)?\s*"
    rf"(?P<age>{_AGE_VALUE})\s*周?岁"
    r"(?P<suffix>及以下|以下|以内)"
)
_AGE_RANGE_REQUIREMENT = re.compile(
    r"年龄(?:要求)?\s*[:：]?\s*(?:须|应|应当)?\s*(?:为|在)?\s*"
    rf"(?P<minimum>{_AGE_VALUE})\s*周?岁(?:及)?以上"
    r"[^。；;\n]{0,20}?"
    rf"(?P<age>{_AGE_VALUE})\s*周?岁(?:及以下|以下|以内)"
)
_EXPERIENCE_NUMBER = r"(?:[1-9]|[12]\d|30|[一二三四五六七八九十两]{1,3})"
_EXPERIENCE_GROUPED = re.compile(
    r"(?P<label>博士(?:研究生)?|硕士(?:研究生)?|(?:大学)?本科|大专|专科)"
    r"[^。；;\n、，]{0,18}?"
    r"(?:工作|从业|任职|经验|经历|年限|满|不少于|至少|不低于)"
    r"[^。；;\n、，]{0,8}?"
    rf"(?P<years>{_EXPERIENCE_NUMBER})\s*年"
)
_EXPERIENCE_GENERIC_PATTERNS = (
    re.compile(
        r"(?:相关)?(?:工作|从业|任职)(?:经验|经历|年限)?"
        r"[^。；;\n、，]{0,8}?"
        r"(?:满|不少于|至少|不低于|达到|需|须|应有|具有)\s*"
        rf"(?P<years>{_EXPERIENCE_NUMBER})\s*年"
    ),
    re.compile(
        r"(?:相关)?(?:工作|从业|任职)(?:经验|经历|年限)?"
        r"[^。；;\n、，]{0,8}?"
        rf"(?P<years>{_EXPERIENCE_NUMBER})\s*年(?:及以上|以上)"
    ),
    re.compile(
        r"(?:具有|具备|拥有)\s*"
        rf"(?P<years>{_EXPERIENCE_NUMBER})\s*年(?:及以上|以上)?"
        r"[^。；;\n、，]{0,12}?"
        r"(?:相关)?(?:工作|从业|任职)(?:经验|经历)?"
    ),
    re.compile(
        rf"(?P<years>{_EXPERIENCE_NUMBER})\s*年(?:及以上|以上)"
        r"[^。；;\n、，]{0,12}?"
        r"(?:相关)?(?:工作|从业|任职)(?:经验|经历)?"
    ),
)
_LANGUAGE_LEVEL_REQUIREMENT = re.compile(
    r"(?P<context>[^。！？；;\n，、]{0,42})"
    r"(?P<level>(?:大学)?英语(?:考试)?[四六]级|CET\s*[-－]?\s*[46])"
    r"(?P<tail>[^。！？；;\n，、]{0,42})",
    re.IGNORECASE,
)
_LANGUAGE_REQUIREMENT_CUE = re.compile(
    r"要求|须|应|通过|合格|水平|成绩|分数|不少于|不低于|"
    r"达到|及以上|以上"
)
_LANGUAGE_SCORE = re.compile(r"(?P<score>\d{3})\s*分?")
_MAJOR_CONTEXT_LABELS = {
    "需求学科",
    "招聘专业",
    "需求专业",
    "急需紧缺专业",
    "专业要求",
    "所学专业",
    "专业范围",
    "专业类别",
    "学科专业",
}
_MAJOR_CONTEXT_LABEL_PATTERN = "|".join(
    sorted(_MAJOR_CONTEXT_LABELS, key=len, reverse=True)
)
_MAJOR_LABELED_REQUIREMENT = re.compile(
    rf"(?P<label>{_MAJOR_CONTEXT_LABEL_PATTERN})"
    r"\s*(?:[:：]|为|包括|含|涵盖|如下[:：]?)\s*"
    r"(?P<value>[^。！？\n]{1,320})"
)
_MAJOR_GENERIC_REQUIREMENT = re.compile(
    r"(?P<label>(?:所学)?专业)"
    r"\s*(?:须|应|必须|仅|只)?\s*"
    r"(?:为|包括|含|涵盖|限于)\s*"
    r"(?P<value>[^。！？\n]{1,320})"
)
_MAJOR_CATEGORY_REQUIREMENT = re.compile(
    r"(?P<label>[\u3400-\u9fffA-Za-z0-9（）()·+\-]{1,20}类)"
    r"\s*[:：]\s*"
    r"(?P<value>[^。！？；;\n]{2,240}?(?:相关)?专业)"
)
_MAJOR_VALUE_STOP = re.compile(
    r"[,，、；;]?\s*"
    r"(?=(?:学历|学位|年龄|工作经验|工作地点|任职资格|资格条件|"
    r"其他条件|户籍|政治面貌|证书|报名方式|投递方式)\s*[:：])"
)
_MAJOR_SEPARATOR = re.compile(r"[,，、/／；;|｜]+")
_LOCATION_CONTEXT_LABELS = {
    "工作地点",
    "工作城市",
    "岗位地点",
    "招聘地点",
    "岗位所在地",
    "工作区域",
    "工作地",
}
_LOCATION_CONTEXT_LABEL_PATTERN = "|".join(
    sorted(_LOCATION_CONTEXT_LABELS, key=len, reverse=True)
)
_LOCATION_LABELED_REQUIREMENT = re.compile(
    rf"(?P<label>{_LOCATION_CONTEXT_LABEL_PATTERN})"
    r"\s*(?:[:：]|为|包括|包含|覆盖)\s*"
    r"(?P<value>[^。！？\n]{1,220})"
)
_LOCATION_VALUE_STOP = re.compile(
    r"[,，、；;]?\s*"
    r"(?=(?:学历|学位|专业|年龄|工作经验|岗位职责|招聘对象|"
    r"福利待遇|薪酬福利|任职资格|资格条件|报名方式|投递方式)"
    r"\s*[:：])"
)
_LOCATION_SEPARATOR = re.compile(r"[,，、/／；;|｜]+")
_LOCATION_ADMIN_SUFFIX = re.compile(
    r"壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省"
)
_HEADCOUNT_NUMBER = (
    r"(?:[1-9]\d{0,5}|[一二三四五六七八九十百千万两〇零]{1,10})"
)
_HEADCOUNT_LABELED = re.compile(
    r"(?:招聘计划人数|招聘人数|招录人数|招聘名额|招录名额)"
    r"\s*(?:[:：]|为|共计|共|合计)?\s*"
    rf"(?P<count>{_HEADCOUNT_NUMBER})\s*(?:人|名|个)"
)
_HEADCOUNT_PLAN = re.compile(
    r"(?:招聘|招录)计划\s*(?:[:：]|为|共计|共|合计)?\s*"
    rf"(?P<count>{_HEADCOUNT_NUMBER})\s*(?:人|名|个)"
)
_HEADCOUNT_TOTAL_RECRUITMENT = re.compile(
    r"(?:(?:本次|此次|本批次)\s*(?:计划|拟)?|"
    r"(?:计划|拟)|(?:面向社会)?公开)"
    r"\s*(?:面向社会)?\s*(?:公开|校园|社会)?\s*"
    r"(?:招聘|招录)\s*"
    r"(?:工作人员|员工|专业人才|人才|高校毕业生|应届毕业生)?\s*"
    r"(?:共计|共|合计)?\s*"
    rf"(?P<count>{_HEADCOUNT_NUMBER})\s*(?:人|名)"
)
_APPLICATION_CHANNEL_CONTEXT = re.compile(
    r"(?:简历)?投递(?:入口|网址|网站|地址|邮箱|方式)?|"
    r"网申(?:入口|网址|网站|地址|方式)?|"
    r"报名(?:入口|网址|网站|地址|邮箱|方式)|"
    r"申请(?:入口|网址|网站|地址|方式)|"
    r"(?:校园)?招聘(?:官网|网站|门户)|"
    r"(?:简历|材料)[^。！？；;\n]{0,20}?(?:发送|投递|提交)"
)
_EMAIL_TOKEN = re.compile(
    r"(?<![A-Z0-9._%+-])"
    r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"
    r"(?![A-Z0-9.-])",
    re.IGNORECASE,
)
_URL_TOKEN = re.compile(
    r"(?<![@A-Z0-9.-])"
    r"(?:(?:https?://)|(?:www\.))?"
    r"(?:[A-Z0-9-]+\.)+[A-Z]{2,}"
    r"(?::\d{2,5})?"
    r"(?:[/?#][^\s<>{}\[\]（）()，。；;、“”‘’\"']*)?",
    re.IGNORECASE,
)
_IGNORED_QUERY_PARAMETERS = {"spm", "from"}
_LIFECYCLE_MARKERS = {
    "withdrawn": re.compile(
        r"撤回|撤销|"
        r"取消(?:本次|本批次|全部|整体)?(?:公开)?招聘|"
        r"终止(?:本次|本批次|全部|整体)?(?:公开)?招聘|"
        + _DECIDED_PARTIAL_WITHDRAWAL.pattern
        + r"|"
        + _APPLIED_PARTIAL_WITHDRAWAL.pattern
    ),
    "resumed": re.compile(
        r"恢复(?:本次|本批次)?(?:20\d{2}年)?(?:公开)?"
        r"(?:招聘|报名|网申|投递)(?:工作|报名)?|"
        r"(?:重新启动|重启)[^。；;\n]{0,20}?(?:招聘|报名|网申|投递)"
    ),
    "paused": re.compile(
        r"(?:暂停|暂缓)[^。；;\n]{0,24}?(?:招聘|报名|网申|投递)"
    ),
    "delayed": re.compile(
        r"延期|"
        r"延长[^。；;\n]{0,40}?(?:报名|网申|投递)(?:时间|日期|期限)?|"
        r"(?:报名|网申|投递)(?:时间|日期|期限)?[^。；;\n]{0,12}?延长|"
        r"截止时间调整"
    ),
    "corrected": re.compile(r"更正公告|补充公告|修订公告|招聘信息更正"),
}
_PARTIAL_CHANGE_SCOPE = re.compile(
    r"部分(?:招聘)?岗位|个别(?:招聘)?岗位|"
    r"(?:取消|核减|调减)[^。；;\n]{0,20}"
    r"(?:岗位|招聘人数|招聘计划)(?:数|人数)?|"
    r"岗位[^。；;\n]{0,18}(?:取消|核减|调减)"
)
_WHOLE_CHANGE_SCOPE = re.compile(
    r"(?:终止|取消|撤回|撤销)"
    r"(?:本次|本批次|全部|整体)[^。；;\n]{0,18}"
    r"(?:公开)?招聘(?:工作|公告|计划)|"
    r"(?:本次|本批次|全部|整体)[^。；;\n]{0,18}"
    r"(?:公开)?招聘(?:工作|公告|计划)[^。；;\n]{0,8}"
    r"(?:终止|取消|撤回|撤销)"
)
_RELATION_GENERIC_TERMS = (
    "招聘信息更正",
    "招聘公告",
    "公开招聘",
    "社会招聘",
    "校园招聘",
    "正式启动",
    "截止时间",
    "报名时间",
    "关于",
    "公告",
    "通知",
    "更正",
    "补充",
    "修订",
    "撤回",
    "撤销",
    "取消",
    "终止",
    "暂停",
    "延期",
    "延长",
    "调整",
    "招聘",
    "报名",
    "投递",
    "启动",
    "恢复",
    "暂缓",
    "重新启动",
    "重启",
)
_PUBLISHER_SUFFIX = re.compile(
    r"[－—]\s*(?:国务院国有资产监督管理委员会|中国就业网).*$"
)
_RELATION_PLAIN = re.compile(r"[^0-9a-z\u3400-\u9fff]+")
_YEAR_TOKEN = re.compile(r"20\d{2}")


def _compact(value: str) -> str:
    return " ".join(str(value or "").split())


def _normalize_date(match: re.Match[str]) -> str:
    return (
        f"{int(match.group('year')):04d}-"
        f"{int(match.group('month')):02d}-"
        f"{int(match.group('day')):02d}"
    )


def _assessment_date_tokens(value: str) -> list[str]:
    tokens: list[tuple[int, int, str]] = []
    full_date_spans: list[tuple[int, int]] = []
    for match in _DATE_PATTERN.finditer(value):
        start, end = match.span()
        full_date_spans.append((start, end))
        tokens.append((start, end, _normalize_date(match)))
    for match in _MONTH_DAY_PATTERN.finditer(value):
        start, end = match.span()
        if any(
            start < full_end and end > full_start
            for full_start, full_end in full_date_spans
        ):
            continue
        tokens.append(
            (
                start,
                end,
                f"--{int(match.group('month')):02d}-"
                f"{int(match.group('day')):02d}",
            )
        )
    return [token for _, _, token in sorted(tokens)]


def _assessment_types(value: str) -> list[str]:
    types: list[str] = []
    if "初选考试" in value:
        types.append("初选考试")
    if "笔试" in value:
        types.append("笔试")
    if "面试" in value:
        types.append("面试")
    if "测评" in value:
        types.append("测评")
    if not types and "考试" in value:
        types.append("考试")
    return types


def _assessment_date_requirements(content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        sentence_types = _assessment_types(sentence)
        if not sentence_types or not _ASSESSMENT_SCHEDULE_CUE.search(sentence):
            continue
        for clause in _ASSESSMENT_CLAUSE_SPLIT.split(sentence):
            dates = _assessment_date_tokens(clause)
            if not dates:
                continue
            types = _assessment_types(clause)
            if not types:
                continue
            if (
                _ASSESSMENT_EXCLUSION.search(clause)
                and not _ASSESSMENT_EXPLICIT_RECRUITMENT.search(clause)
            ):
                continue
            if len(types) > 1 and len(dates) > 1:
                continue
            certainty = (
                "暂定"
                if re.search(r"初定|暂定|拟于|计划于|预计", clause)
                else "确定"
            )
            if len(dates) >= 2 and _RANGE_CONTEXT.search(clause):
                relation = f"={dates[0]}..{dates[-1]}"
                for assessment_type in types:
                    values.add(f"{assessment_type}:{certainty}{relation}")
                continue
            for assessment_type in types:
                for date in dates:
                    values.add(f"{assessment_type}:{certainty}={date}")
    return sorted(values)


def _deadline_date_tokens(value: str) -> list[str]:
    tokens: list[tuple[int, int, str, int | None, int]] = []
    full_date_spans: list[tuple[int, int]] = []
    for match in _DATE_PATTERN.finditer(value):
        start, end = match.span()
        year = int(match.group("year"))
        month = int(match.group("month"))
        full_date_spans.append((start, end))
        tokens.append((start, end, _normalize_date(match), year, month))

    full_tokens = list(tokens)
    for match in _MONTH_DAY_PATTERN.finditer(value):
        start, end = match.span()
        if any(
            start < full_end and end > full_start
            for full_start, full_end in full_date_spans
        ):
            continue
        month = int(match.group("month"))
        day = int(match.group("day"))
        normalized = f"--{month:02d}-{day:02d}"
        previous_full = [
            token for token in full_tokens if token[1] <= start
        ]
        if previous_full:
            _, previous_end, _, previous_year, previous_month = previous_full[-1]
            bridge = value[previous_end:start]
            if (
                previous_year is not None
                and month >= previous_month
                and _RANGE_CONTEXT.search(bridge)
            ):
                normalized = f"{previous_year:04d}-{month:02d}-{day:02d}"
        tokens.append((start, end, normalized, None, month))

    normalized_tokens: list[str] = []
    for _, end, normalized, _, _ in sorted(tokens):
        time_match = _TIME_AFTER_DATE.match(value[end:])
        if time_match:
            minute = (
                time_match.group("colon_minute")
                or time_match.group("hour_minute")
                or "00"
            )
            normalized = (
                f"{normalized}T{int(time_match.group('hour')):02d}:{minute}"
            )
        normalized_tokens.append(normalized)
    return normalized_tokens


def _deadline_dates(content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not _DEADLINE_CONTEXT.search(sentence):
            continue
        pending_context = ""
        for clause in _DEADLINE_CLAUSE_SPLIT.split(sentence):
            has_context = bool(_DEADLINE_CONTEXT.search(clause))
            if not has_context and not pending_context:
                continue
            context = f"{pending_context}{clause}"
            dates = _deadline_date_tokens(clause)
            if not dates:
                pending_context = clause if has_context else ""
                continue
            if (
                _SINGLE_DAY_DEADLINE_CONTEXT.search(context)
                or _RANGE_CONTEXT.search(clause)
            ):
                values.add(dates[-1])
            pending_context = ""
    return sorted(values)


def _minimum_degree(content: str) -> str | None:
    candidates: list[tuple[int, str]] = []
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not _DEGREE_CONTEXT.search(sentence):
            continue
        for rank, (degree, pattern) in enumerate(_DEGREE_PATTERNS):
            if pattern.search(sentence):
                candidates.append((rank, degree))
    if not candidates:
        return None
    return min(candidates, key=lambda item: item[0])[1]


def _graduation_years(content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not _GRADUATION_CONTEXT.search(sentence):
            continue
        for match in _GRADUATION_YEAR.finditer(sentence):
            values.add(match.group("first"))
            if match.group("second"):
                values.add(match.group("second"))
    return sorted(values)


def _graduation_scope(value: str) -> str:
    compact = unicodedata.normalize("NFKC", _compact(value)).replace(" ", "")
    if re.search(r"国(?:\(境\))?内外|境内外|国内外", compact):
        return "境内外"
    if re.search(r"国(?:\(境\))?外|境外|国外|留学", compact):
        return "境外"
    if re.search(r"国(?:\(境\))?内|境内|国内", compact):
        return "境内"
    return "通用"


def _graduation_date_requirements(content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not _GRADUATION_DATE_CONTEXT.search(sentence):
            continue
        sentence_scope = _graduation_scope(sentence)
        for clause in _GRADUATION_CLAUSE_SPLIT.split(sentence):
            dates = [
                _normalize_date(match)
                for match in _DATE_PATTERN.finditer(clause)
            ]
            if not dates:
                continue

            if _GRADUATION_CERTIFICATION_CONTEXT.search(clause):
                requirement_type = "认证"
            elif re.search(
                r"毕业证(?:书)?(?:时间|日期)?|毕业时间|毕业日期",
                clause,
            ) or (
                "毕业生" in sentence
                and re.search(
                    r"取得(?:毕业证(?:书)?|学位证(?:书)?|"
                    r"学历学位证书|证书)",
                    clause,
                )
            ):
                requirement_type = "毕业"
            else:
                continue

            clause_scope = _graduation_scope(clause)
            scope = (
                sentence_scope if clause_scope == "通用" else clause_scope
            )
            if len(dates) >= 2 and _RANGE_CONTEXT.search(clause):
                requirement = f"={dates[0]}..{dates[-1]}"
            elif re.search(r"不早于|以后|之后|起", clause):
                requirement = f"≥{dates[-1]}"
            elif re.search(r"不晚于|截至|截止|以前|之前|前", clause):
                requirement = f"≤{dates[-1]}"
            else:
                requirement = f"={dates[-1]}"
            values.add(f"{scope}:{requirement_type}{requirement}")
    return sorted(values)


def _recruitment_audiences(*, title: str, content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not _RECRUITMENT_AUDIENCE_CONTEXT.search(sentence):
            continue
        specific_graduate_spans: list[tuple[int, int]] = []
        unemployed_matches = list(_UNEMPLOYED_GRADUATE.finditer(sentence))
        current_matches = list(_CURRENT_GRADUATE.finditer(sentence))
        combined_matches = list(_COMBINED_GRADUATE.finditer(sentence))
        previous_matches = list(_PREVIOUS_GRADUATE.finditer(sentence))
        if unemployed_matches:
            values.add("未就业毕业生")
            specific_graduate_spans.extend(
                match.span() for match in unemployed_matches
            )
        if _OVERSEAS_GRADUATE.search(sentence):
            values.add("留学回国人员")
        if combined_matches:
            values.update({"应届毕业生", "往届毕业生"})
            specific_graduate_spans.extend(
                match.span() for match in combined_matches
            )
        else:
            if current_matches:
                values.add("应届毕业生")
                specific_graduate_spans.extend(
                    match.span() for match in current_matches
                )
            if previous_matches:
                values.add("往届毕业生")
                specific_graduate_spans.extend(
                    match.span() for match in previous_matches
                )
        for match in _GENERAL_GRADUATE.finditer(sentence):
            start, end = match.span()
            if not any(
                start < specific_end and end > specific_start
                for specific_start, specific_end in specific_graduate_spans
            ):
                values.add("高校毕业生")
        if re.search(
            r"社会人员|面向社会(?:公开)?招聘|社会公开招聘|"
            r"社会招聘|社招",
            sentence,
        ):
            values.add("社会人员")
        if _SYSTEM_BOTH_AUDIENCE.search(sentence):
            values.update({"系统内人员", "系统外人员"})
        else:
            if "系统内人员" in sentence:
                values.add("系统内人员")
            if "系统外人员" in sentence:
                values.add("系统外人员")
        if "在职人员" in sentence:
            values.add("在职人员")
        if "退役军人" in sentence:
            values.add("退役军人")

    if not values:
        if re.search(r"校园招聘|校招|高校毕业生招聘", title):
            values.add("高校毕业生")
        elif re.search(r"社会招聘|社招|面向社会公开招聘", title):
            values.add("社会人员")
    return sorted(values)


def _application_limits(content: str) -> list[int]:
    values: set[int] = set()
    for pattern in _APPLICATION_LIMIT_PATTERNS:
        values.update(int(match.group(1)) for match in pattern.finditer(content))
    return sorted(values)


def _age_group_label(value: str) -> str:
    compact = unicodedata.normalize("NFKC", _compact(value)).replace(" ", "")
    if "本科" in compact and re.search(r"职业学院|高职|大专|专科", compact):
        return "本科及职业学院"
    for pattern, label in (
        (r"博士", "博士"),
        (r"硕士", "硕士"),
        (r"本科", "本科"),
        (r"职业学院|高职|大专|专科", "专科"),
    ):
        if re.search(pattern, compact):
            return label
    return "通用"


def _age_requirements(content: str) -> list[str]:
    values: set[str] = set()
    for match in _AGE_UPPER_PREFIX.finditer(content):
        comparator = "<" if match.group("operator") in {"不满", "未满"} else "≤"
        values.add(
            f"{_age_group_label(match.group('label'))}="
            f"{comparator}{int(match.group('age'))}"
        )
    for match in _AGE_UPPER_SUFFIX.finditer(content):
        values.add(
            f"{_age_group_label(match.group('label'))}="
            f"≤{int(match.group('age'))}"
        )
    for match in _AGE_RANGE_REQUIREMENT.finditer(content):
        values.add(f"通用=≤{int(match.group('age'))}")
    return sorted(values)


def _parse_experience_years(value: str) -> int | None:
    if value.isdigit():
        years = int(value)
        return years if 1 <= years <= 30 else None
    text = value.replace("两", "二")
    digits = {
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    if "十" in text:
        left, _, right = text.partition("十")
        tens = digits.get(left, 1) if left else 1
        ones = digits.get(right, 0) if right else 0
        years = tens * 10 + ones
    else:
        years = digits.get(text, 0)
    return years if 1 <= years <= 30 else None


def _experience_group_label(value: str) -> str:
    if "博士" in value:
        return "博士"
    if "硕士" in value:
        return "硕士"
    if "本科" in value:
        return "本科"
    return "专科"


def _experience_requirements(content: str) -> list[str]:
    values: set[str] = set()
    grouped_spans: list[tuple[int, int]] = []
    for match in _EXPERIENCE_GROUPED.finditer(content):
        years = _parse_experience_years(match.group("years"))
        if years is None:
            continue
        values.add(
            f"{_experience_group_label(match.group('label'))}=≥{years}"
        )
        grouped_spans.append(match.span())

    for pattern in _EXPERIENCE_GENERIC_PATTERNS:
        for match in pattern.finditer(content):
            start, end = match.span()
            if any(
                start < grouped_end and end > grouped_start
                for grouped_start, grouped_end in grouped_spans
            ):
                continue
            years = _parse_experience_years(match.group("years"))
            if years is not None:
                values.add(f"通用=≥{years}")
    return sorted(values)


def _language_group_label(value: str) -> str:
    compact = _compact(value)
    if "博士" in compact:
        return "博士"
    if "硕士" in compact:
        return "硕士"
    if "本科" in compact:
        return "本科"
    if "研究生" in compact:
        return "研究生"
    return "通用"


def _language_requirements(content: str) -> list[str]:
    values: set[str] = set()
    for match in _LANGUAGE_LEVEL_REQUIREMENT.finditer(content):
        context = match.group("context")
        tail = match.group("tail")
        window = f"{context}{match.group('level')}{tail}"
        if not _LANGUAGE_REQUIREMENT_CUE.search(window):
            continue
        raw_level = unicodedata.normalize(
            "NFKC",
            match.group("level"),
        ).upper()
        level = (
            "CET4"
            if "四" in raw_level or raw_level.rstrip().endswith("4")
            else "CET6"
        )
        score_match = _LANGUAGE_SCORE.search(tail)
        score: int | None = None
        if score_match:
            candidate_score = int(score_match.group("score"))
            if 300 <= candidate_score <= 710:
                score = candidate_score
        requirement = f"{level}≥{score}" if score is not None else level
        values.add(f"{_language_group_label(context)}={requirement}")
    return sorted(values)


def _normalize_major_requirement(*, label: str, value: str) -> str | None:
    normalized_label = unicodedata.normalize("NFKC", _compact(label)).replace(
        " ",
        "",
    )
    normalized_value = unicodedata.normalize("NFKC", _compact(value))
    stop = _MAJOR_VALUE_STOP.search(normalized_value)
    if stop:
        normalized_value = normalized_value[: stop.start()]
    normalized_value = re.sub(
        r"^(?:为|包括|含|涵盖|如下)\s*[:：]?\s*",
        "",
        normalized_value,
    )
    normalized_value = normalized_value.strip(" ：:。！？；;,，、")
    pieces = [
        piece.replace(" ", "").strip(" ：:。！？[]【】")
        for piece in _MAJOR_SEPARATOR.split(normalized_value)
    ]
    pieces = sorted({piece for piece in pieces if piece})
    if not pieces:
        return None
    canonical_label = (
        "专业" if normalized_label in _MAJOR_CONTEXT_LABELS else normalized_label
    )
    return f"{canonical_label}={'、'.join(pieces)}"


def _major_requirements(content: str) -> list[str]:
    values: set[str] = set()
    for pattern in (
        _MAJOR_LABELED_REQUIREMENT,
        _MAJOR_GENERIC_REQUIREMENT,
        _MAJOR_CATEGORY_REQUIREMENT,
    ):
        for match in pattern.finditer(content):
            label = match.group("label")
            if (
                pattern is _MAJOR_CATEGORY_REQUIREMENT
                and label in _MAJOR_CONTEXT_LABELS
            ):
                continue
            normalized = _normalize_major_requirement(
                label=label,
                value=match.group("value"),
            )
            if normalized:
                values.add(normalized)
    return sorted(values)


def _normalize_location_piece(value: str) -> str | None:
    piece = unicodedata.normalize("NFKC", _compact(value)).replace(" ", "")
    piece = piece.strip(" ：:。！？[]【】")
    piece = re.sub(r"(?:等城市|等地|等)$", "", piece)
    piece = _LOCATION_ADMIN_SUFFIX.sub("", piece)
    piece = re.sub(r"市$", "", piece)
    if (
        not piece
        or len(piece) > 18
        or re.search(r"详见|为准|具体|根据|岗位|公司|单位", piece)
        or not re.fullmatch(r"[\u3400-\u9fffA-Za-z·-]+", piece)
    ):
        return None
    return piece


def _work_locations(content: str) -> list[str]:
    values: set[str] = set()
    for match in _LOCATION_LABELED_REQUIREMENT.finditer(content):
        raw_value = unicodedata.normalize("NFKC", _compact(match.group("value")))
        stop = _LOCATION_VALUE_STOP.search(raw_value)
        if stop:
            raw_value = raw_value[: stop.start()]
        raw_value = raw_value.strip(" ：:。！？；;,，、")
        for conjunction in ("和", "及"):
            if raw_value.count(conjunction) == 1:
                left, right = raw_value.split(conjunction, maxsplit=1)
                if 2 <= len(left.strip()) <= 12 and 2 <= len(right.strip()) <= 12:
                    raw_value = f"{left}、{right}"
        pieces = {
            normalized
            for piece in _LOCATION_SEPARATOR.split(raw_value)
            if (normalized := _normalize_location_piece(piece))
        }
        if pieces:
            values.add(f"工作地点={'、'.join(sorted(pieces))}")
    return sorted(values)


def _parse_positive_integer(value: str) -> int | None:
    if value.isdigit():
        parsed = int(value)
        return parsed if 1 <= parsed <= 100_000 else None

    digits = {
        "零": 0,
        "〇": 0,
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    units = {"十": 10, "百": 100, "千": 1_000}
    total = 0
    section = 0
    current = 0
    for character in value:
        if character in digits:
            current = digits[character]
            continue
        if character == "万":
            section += current
            total += (section or 1) * 10_000
            section = 0
            current = 0
            continue
        unit = units.get(character)
        if unit is None:
            return None
        section += (current or 1) * unit
        current = 0
    parsed = total + section + current
    return parsed if 1 <= parsed <= 100_000 else None


def _recruitment_headcounts(content: str) -> list[str]:
    matches: list[tuple[int, int, int]] = []
    for pattern in (
        _HEADCOUNT_LABELED,
        _HEADCOUNT_PLAN,
        _HEADCOUNT_TOTAL_RECRUITMENT,
    ):
        for match in pattern.finditer(content):
            start, end = match.span()
            if any(
                start < matched_end and end > matched_start
                for matched_start, matched_end, _ in matches
            ):
                continue
            count = _parse_positive_integer(match.group("count"))
            if count is not None:
                matches.append((start, end, count))
    return [
        f"招聘人数={count}"
        for _, _, count in sorted(matches, key=lambda item: (item[2], item[0]))
    ]


def _normalize_application_url(value: str) -> str | None:
    raw_value = unicodedata.normalize("NFKC", value).strip()
    candidate = (
        raw_value
        if raw_value.casefold().startswith(("http://", "https://"))
        else f"https://{raw_value}"
    )
    try:
        parsed = urlsplit(candidate)
        hostname = (parsed.hostname or "").casefold().rstrip(".")
        if (
            not hostname
            or "." not in hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            return None
        port = parsed.port
    except ValueError:
        return None

    if hostname.startswith("www."):
        hostname = hostname[4:]
    authority = hostname
    if port and not (
        (parsed.scheme.casefold() == "http" and port == 80)
        or (parsed.scheme.casefold() == "https" and port == 443)
    ):
        authority = f"{authority}:{port}"

    path = re.sub(r"/{2,}", "/", parsed.path or "").rstrip("/")
    parameters = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.casefold().startswith("utm_")
        and key.casefold() not in _IGNORED_QUERY_PARAMETERS
    ]
    query = urlencode(sorted(parameters), doseq=True)
    normalized = f"{authority}{path}"
    if query:
        normalized = f"{normalized}?{query}"
    return normalized


def _has_nearby_application_action(
    sentence: str,
    *,
    start: int,
    end: int,
) -> bool:
    before = sentence[max(0, start - 24):start]
    after = sentence[end:min(len(sentence), end + 30)]
    return bool(
        re.search(r"(?:登录|访问|进入)[^。！？；;\n]{0,8}$", before)
        and re.search(
            r"^[^。！？；;\n]{0,20}(?:报名|投递|网申|申请)",
            after,
        )
    )


def _application_channels(content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        context_matches = list(_APPLICATION_CHANNEL_CONTEXT.finditer(sentence))
        has_application_word = bool(
            re.search(r"报名|投递|网申|申请", sentence)
        )
        if not context_matches and not has_application_word:
            continue

        email_spans: list[tuple[int, int]] = []
        for email_match in _EMAIL_TOKEN.finditer(sentence):
            start, end = email_match.span()
            nearby_context = any(
                abs(start - context.end()) <= 100
                or abs(context.start() - end) <= 40
                for context in context_matches
            )
            if nearby_context:
                values.add(f"邮箱={email_match.group(0).casefold()}")
                email_spans.append((start, end))

        for url_match in _URL_TOKEN.finditer(sentence):
            start, end = url_match.span()
            if any(
                start < email_end and end > email_start
                for email_start, email_end in email_spans
            ):
                continue
            nearby_context = any(
                abs(start - context.end()) <= 100
                or abs(context.start() - end) <= 40
                for context in context_matches
            )
            if not nearby_context and not _has_nearby_application_action(
                sentence,
                start=start,
                end=end,
            ):
                continue
            normalized = _normalize_application_url(url_match.group(0))
            if normalized:
                values.add(f"网址={normalized}")
    return sorted(values)


def _lifecycle_markers(title: str, content: str) -> list[str]:
    title_text = _compact(title)
    lead = _compact(content)[:500]
    values: list[str] = []
    for status, pattern in _LIFECYCLE_MARKERS.items():
        title_match = pattern.search(title_text)
        if (
            status == "withdrawn"
            and not _NEGATED_WITHDRAWAL.search(title_text)
            and _PARTIAL_WITHDRAWAL_TITLE.search(title_text)
        ):
            title_match = True
        lead_match = pattern.search(lead)
        if status == "corrected":
            lead_match = _APPLIED_CORRECTION.search(lead)
        if title_match or (lead_match and _RECRUITMENT_CONTEXT.search(lead)):
            values.append(status)
    return values


def _relation_plain(value: str) -> str:
    without_publisher = _PUBLISHER_SUFFIX.sub("", _compact(value).casefold())
    return _RELATION_PLAIN.sub("", without_publisher)


def _relation_core(value: str) -> str:
    text = _relation_plain(value)
    for term in _RELATION_GENERIC_TERMS:
        text = text.replace(term, "")
    return text


def _relation_type(lifecycle: list[str]) -> str | None:
    for value in ("withdrawn", "resumed", "paused", "delayed", "corrected"):
        if value in lifecycle:
            return value
    return None


def _change_scope(*, title: str, content: str) -> str:
    context = _compact(f"{title} {content[:1_500]}")
    # “部分岗位”是更强的安全信号：即使同段出现“本次招聘”，
    # 也不能据此把整份原公告直接作废。
    if _PARTIAL_CHANGE_SCOPE.search(context):
        return "partial"
    if _WHOLE_CHANGE_SCOPE.search(context):
        return "whole"
    return "unknown"


_COMPLETE_RESUME_SIGNALS = (
    re.compile(
        r"招聘[^。；;\n]{0,50}?(?:\d+|[一二三四五六七八九十]+)\s*名|"
        r"招聘岗位|招聘人数"
    ),
    re.compile(r"(?:招聘|报考|应聘|任职)条件"),
    re.compile(r"报名(?:人员|材料|时间|方式|网址|邮箱)"),
    re.compile(
        r"资格审查[^。；;\n]{0,80}?(?:考试|面试)|"
        r"考试(?:分为|时间|方式)|"
        r"体检[^。；;\n]{0,40}?考察"
    ),
)


def _resume_completeness(
    *,
    relation_type: str,
    content: str,
) -> str | None:
    if relation_type != "resumed":
        return None
    compact = _compact(content)
    signal_count = sum(
        1 for pattern in _COMPLETE_RESUME_SIGNALS if pattern.search(compact)
    )
    if len(compact) >= 280 and signal_count >= 3:
        return "complete"
    return "status_only"


def _resolution_mode(
    *,
    relation_type: str,
    change_scope: str,
    resume_completeness: str | None,
) -> str:
    if relation_type == "withdrawn" and change_scope == "whole":
        return "supersede"
    if relation_type == "resumed" and resume_completeness == "complete":
        return "supersede"
    return "reconcile"


def analyze_cross_document_change(
    *,
    candidate_title: str,
    candidate_content: str,
    candidate_links: list[str] | None,
    existing_documents: list[Mapping[str, Any]],
) -> dict[str, Any]:
    """Identify a new-URL correction and rank possible older announcements."""
    candidate_facts = extract_critical_facts(
        title=candidate_title,
        content=candidate_content,
    )
    lifecycle = list(candidate_facts["lifecycle"])
    relation_type = _relation_type(lifecycle)
    if relation_type is None:
        return {
            "requiresReview": False,
            "relationType": None,
            "lifecycle": [],
            "changeScope": None,
            "resumeCompleteness": None,
            "resolutionMode": None,
            "suggestedTargets": [],
        }

    change_scope = _change_scope(
        title=candidate_title,
        content=candidate_content,
    )
    resume_completeness = _resume_completeness(
        relation_type=relation_type,
        content=candidate_content,
    )
    resolution_mode = _resolution_mode(
        relation_type=relation_type,
        change_scope=change_scope,
        resume_completeness=resume_completeness,
    )
    links = {str(value).strip() for value in candidate_links or [] if str(value).strip()}
    candidate_title_plain = _relation_plain(candidate_title)
    candidate_context_plain = _relation_plain(
        f"{candidate_title} {candidate_content[:1_500]}"
    )
    candidate_title_core = _relation_core(candidate_title)
    candidate_context_core = _relation_core(
        f"{candidate_title} {candidate_content[:1_500]}"
    )
    candidate_years = set(_YEAR_TOKEN.findall(candidate_context_plain))
    suggestions: list[dict[str, Any]] = []

    for existing in existing_documents:
        document_id = str(existing.get("document_id") or existing.get("id") or "")
        title = str(existing.get("title") or "")
        url = str(existing.get("url") or existing.get("canonical_url") or "")
        if not document_id or not title or not url:
            continue
        title_plain = _relation_plain(title)
        title_core = _relation_core(title)
        if len(title_core) < 6:
            continue

        evidence: list[str] = []
        explicit_link = url in links
        explicit_title = (
            len(title_plain) >= 10 and title_plain in candidate_context_plain
        )
        core_reference = (
            len(title_core) >= 7 and title_core in candidate_context_core
        )
        title_similarity = SequenceMatcher(
            None,
            title_core,
            candidate_title_core,
        ).ratio()
        existing_years = set(_YEAR_TOKEN.findall(title_plain))
        shared_year = bool(candidate_years & existing_years)

        if explicit_link:
            score = 1.0
            evidence.append("explicit_link")
            if existing.get("cross_registered_source"):
                evidence.append("cross_registered_source")
        elif explicit_title:
            score = 0.96
            evidence.append("explicit_title")
        elif core_reference:
            score = 0.9
            evidence.append("title_core_reference")
        else:
            score = round(title_similarity * 0.78, 4)
            if title_similarity >= 0.55:
                evidence.append("title_similarity")
            if shared_year:
                score += 0.1
                evidence.append("shared_recruitment_year")
            if existing.get("source_id") == existing.get("candidate_source_id"):
                score += 0.04
                evidence.append("same_registered_source")
            score = min(score, 0.89)

        if score < 0.45:
            continue
        suggestions.append(
            {
                "documentId": document_id,
                "title": title,
                "url": url,
                "score": round(score, 4),
                "blocked": score >= 0.72,
                "evidence": evidence,
            }
        )

    suggestions.sort(
        key=lambda item: (-float(item["score"]), str(item["documentId"]))
    )
    return {
        "requiresReview": True,
        "relationType": relation_type,
        "lifecycle": lifecycle,
        "changeScope": change_scope,
        "resumeCompleteness": resume_completeness,
        "resolutionMode": resolution_mode,
        "candidateFacts": candidate_facts,
        "suggestedTargets": suggestions[:5],
        "unresolved": not any(item["blocked"] for item in suggestions),
    }


def extract_critical_facts(*, title: str, content: str) -> dict[str, Any]:
    compact = _compact(content)
    return {
        "deadlines": _deadline_dates(compact),
        "minimumDegree": _minimum_degree(compact),
        "graduationYears": _graduation_years(compact),
        "graduationDateRequirements": _graduation_date_requirements(compact),
        "recruitmentAudiences": _recruitment_audiences(
            title=title,
            content=compact,
        ),
        "assessmentDates": _assessment_date_requirements(compact),
        "applicationLimits": _application_limits(compact),
        "ageRequirements": _age_requirements(compact),
        "experienceRequirements": _experience_requirements(compact),
        "languageRequirements": _language_requirements(compact),
        "majorRequirements": _major_requirements(content),
        "workLocations": _work_locations(content),
        "recruitmentHeadcounts": _recruitment_headcounts(compact),
        "applicationChannels": _application_channels(content),
        "lifecycle": _lifecycle_markers(title, compact),
    }


def analyze_version_change(
    *,
    previous_title: str,
    previous_content: str,
    previous_metadata: Mapping[str, Any] | None,
    candidate_title: str,
    candidate_content: str,
    candidate_metadata: Mapping[str, Any] | None,
) -> dict[str, Any]:
    previous_metadata = dict(previous_metadata or {})
    candidate_metadata = dict(candidate_metadata or {})
    previous_text = _compact(previous_content)
    candidate_text = _compact(candidate_content)
    previous_facts = extract_critical_facts(
        title=previous_title,
        content=previous_text,
    )
    candidate_facts = extract_critical_facts(
        title=candidate_title,
        content=candidate_text,
    )
    reasons: list[dict[str, Any]] = []

    if candidate_metadata.get("ocrNeedsReview"):
        reasons.append(
            {
                "code": "ocr_quality_pending",
                "facet": "ocrQuality",
                "previous": previous_metadata.get("ocrQualityScore"),
                "candidate": candidate_metadata.get("ocrQualityScore"),
            }
        )

    previous_length = len(previous_text)
    candidate_length = len(candidate_text)
    technical_enrichment = (
        previous_length < 240
        and candidate_length >= 400
        and candidate_length >= previous_length * 1.5
    )
    if (
        previous_length >= 500
        and candidate_length < previous_length * 0.6
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "content_regression",
                "facet": "contentLength",
                "previous": previous_length,
                "candidate": candidate_length,
            }
        )

    if candidate_facts["lifecycle"] and (
        candidate_facts["lifecycle"] != previous_facts["lifecycle"]
    ):
        reasons.append(
            {
                "code": "lifecycle_changed",
                "facet": "lifecycle",
                "previous": previous_facts["lifecycle"],
                "candidate": candidate_facts["lifecycle"],
            }
        )

    comparable_facets = (
        ("deadlines", "deadline_changed"),
        ("minimumDegree", "minimum_degree_changed"),
        ("graduationYears", "graduation_year_changed"),
        ("applicationLimits", "application_limit_changed"),
    )
    for facet, code in comparable_facets:
        previous_value = previous_facts[facet]
        candidate_value = candidate_facts[facet]
        if previous_value and candidate_value and previous_value != candidate_value:
            reasons.append(
                {
                    "code": code,
                    "facet": facet,
                    "previous": previous_value,
                    "candidate": candidate_value,
                }
            )
        elif (
            previous_value
            and not candidate_value
            and candidate_length >= previous_length * 0.7
            and not technical_enrichment
        ):
            reasons.append(
                {
                    "code": f"{code}_removed",
                    "facet": facet,
                    "previous": previous_value,
                    "candidate": candidate_value,
                }
            )
        elif (
            facet == "deadlines"
            and candidate_value
            and not previous_value
            and not technical_enrichment
        ):
            reasons.append(
                {
                    "code": f"{code}_added",
                    "facet": facet,
                    "previous": previous_value,
                    "candidate": candidate_value,
                }
            )

    previous_majors = previous_facts["majorRequirements"]
    candidate_majors = candidate_facts["majorRequirements"]
    if previous_majors and candidate_majors and previous_majors != candidate_majors:
        reasons.append(
            {
                "code": "major_requirement_changed",
                "facet": "majorRequirements",
                "previous": previous_majors,
                "candidate": candidate_majors,
            }
        )
    elif (
        previous_majors
        and not candidate_majors
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "major_requirement_changed_removed",
                "facet": "majorRequirements",
                "previous": previous_majors,
                "candidate": candidate_majors,
            }
        )
    elif candidate_majors and not previous_majors and not technical_enrichment:
        reasons.append(
            {
                "code": "major_requirement_changed_added",
                "facet": "majorRequirements",
                "previous": previous_majors,
                "candidate": candidate_majors,
            }
        )

    previous_locations = previous_facts["workLocations"]
    candidate_locations = candidate_facts["workLocations"]
    if (
        previous_locations
        and candidate_locations
        and previous_locations != candidate_locations
    ):
        reasons.append(
            {
                "code": "work_location_changed",
                "facet": "workLocations",
                "previous": previous_locations,
                "candidate": candidate_locations,
            }
        )
    elif (
        previous_locations
        and not candidate_locations
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "work_location_changed_removed",
                "facet": "workLocations",
                "previous": previous_locations,
                "candidate": candidate_locations,
            }
        )
    elif (
        candidate_locations
        and not previous_locations
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "work_location_changed_added",
                "facet": "workLocations",
                "previous": previous_locations,
                "candidate": candidate_locations,
            }
        )

    previous_headcounts = previous_facts["recruitmentHeadcounts"]
    candidate_headcounts = candidate_facts["recruitmentHeadcounts"]
    if (
        previous_headcounts
        and candidate_headcounts
        and previous_headcounts != candidate_headcounts
    ):
        reasons.append(
            {
                "code": "recruitment_headcount_changed",
                "facet": "recruitmentHeadcounts",
                "previous": previous_headcounts,
                "candidate": candidate_headcounts,
            }
        )
    elif (
        previous_headcounts
        and not candidate_headcounts
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "recruitment_headcount_changed_removed",
                "facet": "recruitmentHeadcounts",
                "previous": previous_headcounts,
                "candidate": candidate_headcounts,
            }
        )
    elif (
        candidate_headcounts
        and not previous_headcounts
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "recruitment_headcount_changed_added",
                "facet": "recruitmentHeadcounts",
                "previous": previous_headcounts,
                "candidate": candidate_headcounts,
            }
        )

    previous_channels = previous_facts["applicationChannels"]
    candidate_channels = candidate_facts["applicationChannels"]
    if (
        previous_channels
        and candidate_channels
        and previous_channels != candidate_channels
    ):
        reasons.append(
            {
                "code": "application_channel_changed",
                "facet": "applicationChannels",
                "previous": previous_channels,
                "candidate": candidate_channels,
            }
        )
    elif (
        previous_channels
        and not candidate_channels
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "application_channel_changed_removed",
                "facet": "applicationChannels",
                "previous": previous_channels,
                "candidate": candidate_channels,
            }
        )
    elif (
        candidate_channels
        and not previous_channels
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "application_channel_changed_added",
                "facet": "applicationChannels",
                "previous": previous_channels,
                "candidate": candidate_channels,
            }
        )

    previous_ages = previous_facts["ageRequirements"]
    candidate_ages = candidate_facts["ageRequirements"]
    if previous_ages and candidate_ages and previous_ages != candidate_ages:
        reasons.append(
            {
                "code": "age_requirement_changed",
                "facet": "ageRequirements",
                "previous": previous_ages,
                "candidate": candidate_ages,
            }
        )
    elif (
        previous_ages
        and not candidate_ages
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "age_requirement_changed_removed",
                "facet": "ageRequirements",
                "previous": previous_ages,
                "candidate": candidate_ages,
            }
        )
    elif candidate_ages and not previous_ages and not technical_enrichment:
        reasons.append(
            {
                "code": "age_requirement_changed_added",
                "facet": "ageRequirements",
                "previous": previous_ages,
                "candidate": candidate_ages,
            }
        )

    previous_experience = previous_facts["experienceRequirements"]
    candidate_experience = candidate_facts["experienceRequirements"]
    if (
        previous_experience
        and candidate_experience
        and previous_experience != candidate_experience
    ):
        reasons.append(
            {
                "code": "experience_requirement_changed",
                "facet": "experienceRequirements",
                "previous": previous_experience,
                "candidate": candidate_experience,
            }
        )
    elif (
        previous_experience
        and not candidate_experience
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "experience_requirement_changed_removed",
                "facet": "experienceRequirements",
                "previous": previous_experience,
                "candidate": candidate_experience,
            }
        )
    elif (
        candidate_experience
        and not previous_experience
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "experience_requirement_changed_added",
                "facet": "experienceRequirements",
                "previous": previous_experience,
                "candidate": candidate_experience,
            }
        )

    previous_language = previous_facts["languageRequirements"]
    candidate_language = candidate_facts["languageRequirements"]
    if (
        previous_language
        and candidate_language
        and previous_language != candidate_language
    ):
        reasons.append(
            {
                "code": "language_requirement_changed",
                "facet": "languageRequirements",
                "previous": previous_language,
                "candidate": candidate_language,
            }
        )
    elif (
        previous_language
        and not candidate_language
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "language_requirement_changed_removed",
                "facet": "languageRequirements",
                "previous": previous_language,
                "candidate": candidate_language,
            }
        )
    elif (
        candidate_language
        and not previous_language
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "language_requirement_changed_added",
                "facet": "languageRequirements",
                "previous": previous_language,
                "candidate": candidate_language,
            }
        )

    previous_graduation_dates = previous_facts["graduationDateRequirements"]
    candidate_graduation_dates = candidate_facts["graduationDateRequirements"]
    if (
        previous_graduation_dates
        and candidate_graduation_dates
        and previous_graduation_dates != candidate_graduation_dates
    ):
        reasons.append(
            {
                "code": "graduation_date_requirement_changed",
                "facet": "graduationDateRequirements",
                "previous": previous_graduation_dates,
                "candidate": candidate_graduation_dates,
            }
        )
    elif (
        previous_graduation_dates
        and not candidate_graduation_dates
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "graduation_date_requirement_changed_removed",
                "facet": "graduationDateRequirements",
                "previous": previous_graduation_dates,
                "candidate": candidate_graduation_dates,
            }
        )
    elif (
        candidate_graduation_dates
        and not previous_graduation_dates
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "graduation_date_requirement_changed_added",
                "facet": "graduationDateRequirements",
                "previous": previous_graduation_dates,
                "candidate": candidate_graduation_dates,
            }
        )

    previous_audiences = previous_facts["recruitmentAudiences"]
    candidate_audiences = candidate_facts["recruitmentAudiences"]
    if (
        previous_audiences
        and candidate_audiences
        and previous_audiences != candidate_audiences
    ):
        reasons.append(
            {
                "code": "recruitment_audience_changed",
                "facet": "recruitmentAudiences",
                "previous": previous_audiences,
                "candidate": candidate_audiences,
            }
        )
    elif (
        previous_audiences
        and not candidate_audiences
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "recruitment_audience_changed_removed",
                "facet": "recruitmentAudiences",
                "previous": previous_audiences,
                "candidate": candidate_audiences,
            }
        )
    elif (
        candidate_audiences
        and not previous_audiences
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "recruitment_audience_changed_added",
                "facet": "recruitmentAudiences",
                "previous": previous_audiences,
                "candidate": candidate_audiences,
            }
        )

    previous_assessment_dates = previous_facts["assessmentDates"]
    candidate_assessment_dates = candidate_facts["assessmentDates"]
    if (
        previous_assessment_dates
        and candidate_assessment_dates
        and previous_assessment_dates != candidate_assessment_dates
    ):
        reasons.append(
            {
                "code": "assessment_date_changed",
                "facet": "assessmentDates",
                "previous": previous_assessment_dates,
                "candidate": candidate_assessment_dates,
            }
        )
    elif (
        previous_assessment_dates
        and not candidate_assessment_dates
        and candidate_length >= previous_length * 0.7
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "assessment_date_changed_removed",
                "facet": "assessmentDates",
                "previous": previous_assessment_dates,
                "candidate": candidate_assessment_dates,
            }
        )
    elif (
        candidate_assessment_dates
        and not previous_assessment_dates
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "assessment_date_changed_added",
                "facet": "assessmentDates",
                "previous": previous_assessment_dates,
                "candidate": candidate_assessment_dates,
            }
        )

    return {
        "requiresReview": bool(reasons),
        "reasons": reasons,
        "previousFacts": previous_facts,
        "candidateFacts": candidate_facts,
        "technicalEnrichment": technical_enrichment,
        "previousLength": previous_length,
        "candidateLength": candidate_length,
    }
