"""Content taken from the academy's Naver blog (blog.naver.com/o_oa8), which is the source of truth
for the school's facts. Transcribed 2026-10-10 (most of it lives in images on the blog); the full
transcription is kept in docs/blog.md. build_pages.py renders this into the about page sections.

No tuition anywhere (house rule). Student names are left out: the blog only shows them masked."""
from html import escape

BLOG = "https://blog.naver.com/o_oa8"
BLOG_RESULTS = "https://blog.naver.com/PostList.naver?blogId=o_oa8&categoryNo=24"
BLOG_TIPS = "https://blog.naver.com/PostList.naver?blogId=o_oa8&categoryNo=30"
YT = "https://www.youtube.com/@vocallesson1533"
YT_AUDITION = "https://www.youtube.com/@leesh_audition"
INSTA_AUDITION = "https://www.instagram.com/leeshvocal_auditionn/"
INSTA_HOBBY = "https://www.instagram.com/leeshvocal_hobby/"
B = "assets/img/blog/"

# ---------------------------------------------------------------- teachers

DIRECTOR = {
    "lead": ["대형 기획사 보컬 트레이너", "11년차 보컬 트레이너", "최단 기간(3주) 대형 기획사 합격생 배출"],
    "groups": [
        ("학력 · 자격", [
            "명지전문대 실용음악과 보컬전공 졸업",
            "교원자격증(실기교사 자격증) 취득",
            "스피치 지도사 1 · 2급, 이미지 메이킹 지도사 1급",
            "노영주(파워보컬) · 박선주(모래공장) 교수님 사사",
            "명지전문대 실용음악과 출강 중",
            "보컬트레이너편 비기너 시리즈 저서 집필 중 (이담북스 / 한국학술정보)",
        ]),
        ("현장 경력", [
            "엔터테인먼트 음반기획 · 신인개발팀(오디션 전담) 근무",
            "키이스트 엔터테인먼트 일본 프로젝트 그룹 전담 보컬 트레이너",
            "현직 가수 가이드 보컬 녹음 (백아연 · 현아 · 펀치 등)",
            "MBK 최종 합격, SM · JYP 오디션 합격",
            "기획사 데뷔조 연습생 출신",
        ]),
        ("방송 · 앨범", [
            "KBS 〈라운드 테이블〉 판정단 출연",
            "MBC MUSIC 〈셔플 오디션〉 최종 6인 전담 트레이너",
            "〈호텔 델루나〉 · 〈낭만닥터 김사부〉 OST 전곡 프로듀싱 제작 디렉션 참여",
            "가수 클로이(Klloy) 솔로 활동",
            "2019 〈미친 소리인 거 알지만〉 · 2020 〈비가〉 앨범 발매",
        ]),
    ],
}

# 댄스 강사 프로필은 원장님 요청으로 홈페이지에서 뺌 (2026-10-29).
STAFF_NOTE = "모든 강사진이 신인개발팀 · 연습생 경력, 강남권 학원 출강 경력을 갖고 있어요."

# ---------------------------------------------------------------- curriculum

# 커리큘럼 (원장님 2026-10-29 새 안내 이미지 그대로: 오디션 심화반 NEW, 반 번호, STEP 문구, 심화반 추가 커리큘럼)
CLASSES = ["오디션 심화반", "오디션반", "입시반", "전문반", "취미반"]
CLASSES_NEW = {"오디션 심화반"}
CLASSES_NUMS = "취미반 (1, 2번) · 전문반 (1, 2, 3번) · 입시 · 오디션반 (1, 2, 3, 4번)에 해당하여 레슨을 진행해요."
CLASSES_NOTE = "모든 반은 담임제예요. 담당 선생님이 직접 상담부터 레슨까지 진행하고, 레슨 후 1:1 맞춤형 피드백을 드려요."
STEPS = [
    ("노래 진단", ["학생의 노래를 들어보며 기초 발성을 파악 후 피드백 및 맞춤형 기본기 수업 진행"]),
    ("실전 수업", ["기본기를 노래에 직접 적용하며 발성의 기량을 증진시키는 실전 방법",
                "곡을 잘 부를 수 있는 보컬 스킬의 원포인트 레슨 진행"]),
    ("디테일 레슨", ["기본 발성 점검 후 음정, 박자, 발성 등 전체적인 소리 점검",
                  "프로 가수 같은 톤 메이킹, 감정 표현, 끝음 처리 등의 디테일 원포인트 레슨 진행"]),
    ("디테일 플래닝", ["대학교 (고입 · 대입 · 편입), 기획사 → 전략적인 개인 맞춤형 플래닝 설정",
                    "대학교 (고입 · 대입 · 편입), 기획사 → 장점 특화 선곡 및 개인 스케줄 관리",
                    "자기소개 스피치 (전문 자격증 소지)",
                    "전속 계약서 검토 (자문 위원 위촉)",
                    "액팅 레슨 (비주얼 모니터링: 눈빛, 시선 처리, 표정, 제스처 등)",
                    "스타일링 체크 (퍼스널 컬러, 체형 보완 등)",
                    "다이어트 케어 (식단 관리 및 식단 피드백 등)",
                    "월 오디션마다 영상 모니터링을 통한 1:1 피드백",
                    "분기별 월말평가 후 1:1 피드백",
                    "매월 학원 내방 오디션 진행 (신인개발팀 담당자 대면 심사)",
                    "영상 캐스팅 오디션 진행",
                    "본사 비공개 오디션 진행"]),
]
# 오디션 심화반 추가 커리큘럼 (기존 오디션반 커리큘럼은 적용되어 있음)
ADVANCED = [
    ("보컬 레슨", ["매월 온라인 접수용 영상 촬영 및 보정 & 편집", "기획사별 오디션 곡 리스트 제공"]),
    ("댄스 특강", ["ONLY 1:5 소수 집중 레슨", "대형 기획사 기본기 커리큘럼 적용", "매 레슨 1:1 디테일 체크"]),
]
ADVANCED_NOTE = "* 대표원장 1:1 오디션 컨설팅 및 외부 특강 포함"

WHY = [
    ("실무자 출신의 강사진", ["대형 기획사 보컬 트레이너", "기획사 음반기획 / 신인개발팀 근무", "데뷔조 연습생 경력 및 현직 가수"]),
    ("체계적인 커리큘럼", ["대형 기획사 연습생 레슨 커리큘럼 적용", "1:1 담임제로 학생별 맞춤형 레슨",
                       "분기별 월말평가로 객관적인 피드백", "액팅 레슨으로 베스트 컨디션 찾기 (퍼스널 컬러 · 스타일링 · 표정 · 시선 처리)"]),
    ("다양한 오디션의 기회", ["대형 기획사 및 매월 학원 내방 오디션", "본사 비공개 오디션", "영상 캐스팅 오디션", "신인개발팀 담당자 대면 심사"]),
    ("학원 자체 연습실", ["365일 24시간 무료 사용", "사전 예약제로 대기 없이 사용", "춤 연습실 무료 제공 (1인 단독 사용)",
                     "모든 연습실 컴퓨터 · 에어컨 · 피아노 완비", "약 50cm 방음벽 (스튜디오 퀄리티)"]),
]
WHY_LOGOS = "HYBE · YG · SM · JYP · SOURCE MUSIC · ADOR"
FAQ_Q = "우리 학원만의 특징은 무엇인가요?"
FAQ_A = [
    "대형 기획사 보컬 트레이너 원장님의 1:1 레슨 및 월말평가 피드백",
    "담당 선생님이 직접 상담부터 레슨 및 레슨 후 피드백 1:1 맞춤형 레슨",
    "실무자 출신의 강사진: 신인개발팀 근무, 대형 기획사 위탁 트레이닝, 데뷔조 연습생 등",
    "최단 기간(3주) 대형 기획사 합격생 배출 경험",
    "분기별 월말평가 진행 (실제 오디션 모의 진행 및 피드백)",
    "365일 24시간 학원 자체 연습실 개방 (1인 댄스 연습실 무료 제공)",
]
MOTTO = ("오디션은 많이 보는 것보다<br>정확한 정보로 제대로 보는 것이 더 중요합니다.",
         "대형 기획사 보컬 트레이너 원장의 현 필드에서의 확실한 보컬 티칭 노하우와 오디션 정보로 책임감 있게 지도합니다.")

# ---------------------------------------------------------------- audition care

CARE = [
    ("오디션 코칭", ["매달 오디션 세미나 (그 달의 오디션 소개 · 준비 사항 · 노하우)", "월말평가로 하는 실전 오디션 연습",
                  "최신 오디션 정보 전달 및 피드백", "오디션 전담 선생님 배치",
                  "최종 오디션까지 나만의 선곡 레퍼토리 + 유형별 퍼스널 선곡", "오디션 무반주 구간 설정 및 편집"]),
    ("매일 관리", ["카카오톡 1:1 보컬 / 댄스 데일리 피드백", "연습 일지 체크 및 연습 방향 제시",
                "매 레슨마다 레슨일지 작성 · 공유", "월별 플랜 작성 및 공유"]),
    ("비주얼 케어", ["오디션 베스트 스타일링 체크 (옷 · 헤어 · 메이크업)", "다이어트 케어 (체형별 운동 · 맞춤 식단 관리 · 상시 피드백)",
                  "액팅 레슨 (눈빛 · 시선 처리 · 표정 · 제스처)", "자기소개 스피치 · 전속 계약서 검토"]),
]
PARTNERS = ["헤어 메이크업", "붙임머리", "스타일링 컨설팅", "경락", "헬스장", "피부과", "성형외과", "치과", "촬영 스튜디오", "심리상담센터"]
ONLINE = {
    "lead": "보컬 + 댄스를 한 번에, 온라인으로도 배울 수 있어요. 고음질 · 고화질 장비로 오프라인 레슨과 똑같이 진행해요.",
    "dance": [("기본기", "업다운 · 아이솔레이션 · 선 뻗기 · 스텝 · 힐댄스"),
              ("연습생 기본기 루틴", "대형 기획사 연습생들이 실제로 배우는 루틴"),
              ("댄스 루틴", "힙합 · 걸스힙합"),
              ("디테일 표현", "손끝 · 발끝 · 어깨 · 머리카락"),
              ("스타일링 노하우", "체형별 · 장르별 스타일링"),
              ("오디션 꿀팁", "안무 카피 · 빠르게 실력 느는 법 · 나에게 어울리는 춤")],
}

# ---------------------------------------------------------------- results

DEBUTS = [
    ("tripleS", "김유연", "걸그룹 트리플에스 데뷔"),
    ("MEOVV", "나린", "더블랙레이블 테디의 첫 걸그룹 미야오 · 2nd single 〈TOXIC〉"),
    ("투엘슨 Ent.", "", "최종 합격 및 앨범 데뷔"),
]
# 오디션 합격자 배출 현황 board on the blog (kept current), one card per company or programme.
AGENCIES = [
    ("SM 엔터테인먼트", ["1차 · 2차 합격, 3차 진행", "최종 합격", "비공개 오디션 1차 합격", "글로벌 오디션 1차 합격 · 2차 진행",
                     "토요공개오디션 2차 진행", "학생 DM 캐스팅"]),
    ("JYP 엔터테인먼트", ["연습생 최종 합격", "1차 합격"]),
    ("YG 엔터테인먼트", ["비공개 오디션 2차 합격", "SM · YG 1차 동시 합격"]),
    ("어도어 (ADOR)", ["1차 합격", "1차 합격 및 2차 진행"]),
    ("CUBE 엔터테인먼트", ["연습생 최종 합격", "1차 합격", "이메일 · 비공개 오디션 1차 합격", "학생 DM 캐스팅"]),
    ("플레디스", ["1차 · 2차 합격", "최종 오디션 진행", "비공개 영상 오디션 1차 합격", "학생 DM 캐스팅"]),
    ("빌리프랩 (BE:LIFT)", ["1차 합격"]),
    ("쏘스뮤직", ["1차 합격", "2차 진행", "비공개 영상 오디션 1차 합격"]),
    ("FNC 엔터테인먼트", ["최종 합격", "1차 합격", "비공개 영상 오디션 1차 합격"]),
    ("스타쉽 엔터테인먼트", ["최종 합격", "공개 오디션 1차 합격", "비공개 영상 오디션 1차 합격", "학생 DM · 콘테스트 캐스팅"]),
    ("더블랙레이블", ["1차 · 2차 합격", "학생 DM 캐스팅"]),
    ("웨이크원", ["최종 합격", "1차 · 2차 합격", "내방 오디션 1차 합격"]),
    ("카카오엔터테인먼트", ["최종 합격", "1차 합격"]),
    ("카카오M (구 로엔)", ["합격", "1차 합격", "학생 DM 캐스팅"]),
    ("피네이션 (P NATION)", ["1차 · 2차 합격", "온라인 오디션 1차 합격", "비공개 영상 오디션 1차 합격"]),
    ("CJ ENM", ["비공개 오디션 최종 합격", "비공개 오디션 2차 합격"]),
    ("판타지오", ["최종 합격", "1차 합격", "비공개 영상 오디션 1차 합격"]),
    ("하이업 엔터테인먼트", ["최종 합격", "1차 합격", "비공개 영상 · 내방 오디션 1차 합격"]),
    ("미스틱스토리", ["최종 합격", "1차 합격"]),
    ("젤리피쉬 엔터테인먼트", ["1차 합격"]),
    ("울림 엔터테인먼트", ["1차 합격"]),
    ("안테나", ["1차 합격"]),
    ("워너뮤직", ["1차 합격"]),
    ("어트랙트", ["1차 합격"]),
    ("모드하우스", ["1차 합격", "학생 DM 캐스팅"]),
    ("TOP미디어", ["1차 합격", "비공개 영상 오디션 1차 합격"]),
    ("위에화 엔터테인먼트", ["내방 오디션 1차 합격", "학생 DM 캐스팅"]),
    ("MNH 엔터테인먼트", ["1차 · 2차 합격", "비공개 영상 오디션 1차 합격", "학생 DM · 콘테스트 캐스팅"]),
    ("바인 엔터테인먼트", ["최종 합격", "1차 합격", "비공개 영상 오디션 1차 합격"]),
    ("디네이션", ["최종 합격", "1차 합격"]),
    ("모어비전", ["최종 합격"]),
    ("인코드", ["최종 합격"]),
    ("울프번", ["최종 합격"]),
    ("올라트 엔터테인먼트", ["최종 합격"]),
    ("131LABEL", ["최종 합격 · 연습생 계약"]),
    ("저스트포커스", ["최종 합격 · 연습생 계약"]),
    ("엔터테인먼트 컵", ["최종 합격"]),
    ("레토피아살롱", ["최종 합격"]),
    ("후너스 엔터테인먼트", ["최종 합격"]),
    ("남남 엔터테인먼트", ["최종 합격"]),
    ("이든 엔터테인먼트", ["합격"]),
    ("하이헷 엔터테인먼트", ["1차 합격", "학생 DM · 팝업 현장 캐스팅"]),
    ("그레이트엠", ["1차 합격", "학생 DM 캐스팅"]),
    ("빌 엔터테인먼트", ["1차 합격", "학생 DM 캐스팅"]),
    ("ATRP", ["1차 합격", "내방 오디션 1차 합격"]),
    ("143 엔터테인먼트", ["1차 · 2차 합격"]),
    ("IST 엔터테인먼트", ["1차 합격 및 2차 진행"]),
    ("타이탄콘텐츠", ["2차 합격", "DM 캐스팅"]),
    ("블록베리크리에이티브", ["1차 합격"]),
    ("SW 엔터테인먼트", ["1차 합격"]),
    ("DOD 엔터테인먼트", ["1차 합격"]),
    ("nCH 엔터테인먼트", ["1차 합격"]),
    ("withHC", ["1차 합격"]),
    ("딥스튜디오", ["1차 합격"]),
    ("누아 엔터테인먼트", ["1차 합격"]),
    ("어비스 컴퍼니", ["비공개 DM 오디션 1차 합격"]),
    ("이닛 엔터테인먼트", ["내방 오디션 1차 합격"]),
    ("KOZ 엔터테인먼트", ["내방 오디션 1차 합격"]),
    ("S2 엔터테인먼트", ["내방 오디션 1차 합격"]),
    ("비공개 대형 기획사", ["내방 오디션 1차 합격"]),
    ("BLADE 엔터테인먼트", ["학생 DM 캐스팅"]),
    ("WM 엔터테인먼트", ["학생 DM 캐스팅"]),
]
SHOWS = [
    ("MBC 〈방과후 설렘〉", ["오디션 최종 합격", "파이널 진출"]),
    ("JTBC 〈PROJECT 7〉", ["최종 합격 및 방송 출연"]),
    ("JTBC 〈날아라 병아리〉", ["최종 합격"]),
    ("JTBC 신규 여성 보컬 프로그램", ["1차 합격", "1차 · 2차 오디션 진행"]),
    ("SBS 〈유니버스 티켓〉", ["최종 합격", "1차 합격"]),
    ("Mnet 〈보이즈 플래닛〉", ["2차 오디션 진행"]),
    ("Mnet 〈아이랜드2〉", ["1차 합격"]),
    ("〈내일은 미스트롯〉", ["본선 진출"]),
    ("츄앙 아시아 (CHUANG ASIA)", ["걸그룹 중국 프로그램 최종 합격"]),
    ("포켓TV 〈놀아줘클럽〉", ["최종 합격"]),
    ("〈UNDER15〉", ["1차 합격"]),
    ("글로벌 청소년 K-POP 콘테스트", ["결선 진출"]),
]
SCHOOLS = [
    ("예고", ["서울예술고등학교 합격", "한림예술고등학교 합격 · 편입 합격", "리라아트고등학교 합격"]),
    ("대학 (실용음악과 · K-POP학과 · 방송연예과 등)", [
        "서울예술대학교 1차 합격 3명", "한양대학교 수시 합격", "경희대학교 정시 합격",
        "동아방송예술대학교 수시 최종 합격", "명지전문대학교 수시 최종 합격 2명 · 정시 최종 합격",
        "한양여자대학교 정시 최종 합격", "동서울대학교 수시 최종 합격"]),
]
# 2025 congratulation posts on the blog (합격자 현황 category), newest first
RECENT_2025 = ["웨이크원", "스타쉽", "피네이션", "이든 엔터테인먼트", "이닛 엔터테인먼트", "바인 엔터테인먼트", "그레이트엠",
               "누아 엔터테인먼트", "어트랙트", "nCH 엔터테인먼트", "S2 엔터테인먼트", "딥스튜디오", "withHC", "워너뮤직",
               "JYP", "SM", "하이업", "모드하우스", "CUBE", "저스트포커스", "플레디스", "판타지오", "TOP미디어", "위에화",
               "레토피아살롱", "비공개 대형 기획사", "FNC", "YG", "울림", "JTBC 〈날아라 병아리〉", "KOZ", "ATRP", "디네이션",
               "MNH", "젤리피쉬", "리라아트고"]

# ---------------------------------------------------------------- rooms

ROOM_PHOTOS = [
    ("outside", "학원 건물 · 선릉역 도보 2~3분", "wide"),
    ("sign", "학원 입구", ""),
    ("hallway", "연습실 복도", ""),
    ("room-1", "스튜디오형 연습실 1", ""),
    ("room-2", "스튜디오형 연습실 2", ""),
    ("room-3", "스튜디오형 연습실 3", ""),
    ("booth-1", "녹음 마이크 · 모니터 스피커", ""),
    ("chall", "C hall · 댄스 연습실 (1인 단독)", "wide"),
    ("audition-board", "학원 내방 오디션 공지", ""),
    ("lesson", "레슨 중", ""),
]
ROOM_FACTS = [
    "모든 연습실은 수강생 365일 24시간 무료",
    "사전 예약제라 기다리지 않고 혼자 써요",
    "한 번에 최대 2시간 · 오늘·내일 예약",
    "50인치 모니터 · 노트북 · 삼각대 · 피아노 · 에어컨 · 공기청정기",
    "50cm 이상 방음벽의 스튜디오형 연습실",
    "C hall 댄스 연습실 (약 10평, 1인 단독 사용)",
]
ROOM_LINE = "칸막이로만 된 연습실에서 소리가 새어 나가 마음 편히 연습 못 하셨죠? 50cm 이상 방음이 된 스튜디오형 연습실에서 프라이빗하게 연습하세요."

# ---------------------------------------------------------------- one-point lessons (blog posts)

TIPS = [
    ("나에게 맞는 선곡 꿀팁", 223552154653),
    ("고음이 안 됐던 이유, 바로 이거 때문이에요", 223451491547),
    ("가수처럼 느낌 있게 노래 부르고 싶다면", 223451469104),
    ("노래 연습 절대 이렇게 하지 마세요", 223451467840),
    ("진성에서 가성! 자연스럽게 연결하기", 223420864696),
    ("노래 부를 때 호흡 딸리는 이유", 223380536192),
    ("대형기획사 오디션, '이것' 준비해야 붙습니다", 223376691449),
    ("보컬프라이로 노래 디테일 살리는 법", 223367905734),
    ("기획사 오디션에서 '이 질문' 받아보셨나요?", 223344382657),
    ("오디션 잘 보는 법", 223314503415),
    ("노래에 바로 써먹는 복식호흡 하는 법", 223307654347),
    ("누구나 퀄리티 높은 영상 오디션 찍는 방법", 223281073187),
]

DIRECTIONS = {
    "address": "서울 강남구 테헤란로55길 21 미승(태원)빌딩 2층",
    "subway": "2호선 · 수인분당선 선릉역 7번 출구, 걸어서 2~3분",
    "steps": ["선릉역 7번 출구에서 직진", "파리바게뜨에서 왼쪽으로", "배스킨라빈스와 청춘화로 사이 골목으로 직진",
              "왼쪽, 1층 볼빨간딱새우 건물 2층"],
}


# ================================================================ rendering

def _ul(items, cls=""):
    c = f' class="{cls}"' if cls else ""
    return f"<ul{c}>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def _head(kicker, title, sid):
    return (f'    <header class="scrap__head" id="{sid}">\n'
            f'      <p class="scrap__kicker">{kicker}</p>\n'
            f'      <h2 class="scrap__title">{title}</h2>\n'
            f'    </header>\n')


def _photo(name, caption, cls=""):
    return (f'<figure class="snap {cls}"><img src="{B}{name}.webp" alt="{escape(caption)}" loading="lazy">'
            f'<figcaption>{caption}</figcaption></figure>')


def teacher_section():
    d = DIRECTOR
    groups = "".join(f'<div class="card__col"><h4>{t}</h4>{_ul(items)}</div>' for t, items in d["groups"])
    return (_head("the teacher", "무대에 서본 사람이 가르쳐요", "teacher")
            + '    <div class="teacher">\n'
            + '      <div class="teacher__photos">' + _photo("director", "대표원장 이송희", "snap--tilt-l")
            + _photo("klloy-album", "가수 클로이 (Klloy)", "snap--small snap--tilt-r") + "</div>\n"
            + '      <article class="card card--paper">\n'
            + '        <p class="card__name">대표원장 <b>이송희</b> <span>가수 클로이 · Klloy</span></p>\n'
            + "        " + _ul(d["lead"], "card__lead") + "\n"
            + f'        <div class="card__cols">{groups}</div>\n'
            + "      </article>\n"
            + "    </div>\n"
            + f'    <p class="scrap__note">{STAFF_NOTE}</p>\n')


def steps_section():
    classes = "".join(('<li class="is-new">' + c + '<span class="classes__new">NEW</span></li>') if c in CLASSES_NEW
                      else f"<li>{c}</li>" for c in CLASSES)
    steps = "".join(
        f'<li class="step{" step--wide" if i == 3 else ""}"><span class="step__no">STEP 0{i + 1}</span>'
        f'<h3>{t}</h3>{_ul(items)}</li>' for i, (t, items) in enumerate(STEPS))
    plus = "".join(f'<li class="step step--plus"><h3>{t}</h3>{_ul(items)}</li>' for t, items in ADVANCED)
    return (_head("4 steps", "진단부터 플래닝까지", "steps")
            + f'    <ul class="classes">{classes}</ul>\n'
            + f'    <p class="scrap__lede">{CLASSES_NUMS}<br>{CLASSES_NOTE}</p>\n'
            + f'    <ol class="steps">{steps}</ol>\n'
            + '    <h3 class="scrap__sub" id="advanced">오디션 심화반 추가 커리큘럼 <span class="classes__new">NEW</span></h3>\n'
            + '    <p class="scrap__lede">기존 오디션반 커리큘럼은 모두 적용되어 있어요.</p>\n'
            + f'    <ul class="steps steps--plus">{plus}</ul>\n'
            + f'    <p class="scrap__note">{ADVANCED_NOTE}</p>\n'
            + '    <p class="scrap__note">매 레슨이 끝나면 레슨일지를 써서 공유해요. 월말평가 결과는 홈 화면 <a href="index.html#evals">내 폴더</a>에서 볼 수 있어요.</p>\n')


def why_section():
    cards = "".join(f'<li class="why"><span class="why__no">0{i + 1}</span><h3>{t}</h3>{_ul(items)}</li>'
                     for i, (t, items) in enumerate(WHY))
    return (_head("why us", "우리 학원만의 특징", "why")
            + f'    <ol class="whys">{cards}</ol>\n'
            + f'    <p class="scrap__note">내방 · 비공개 오디션을 함께한 곳: {WHY_LOGOS} 등</p>\n'
            + '    <div class="faq">\n'
            + f'      <p class="faq__q">Q. {FAQ_Q}</p>\n'
            + "      " + _ul(FAQ_A, "faq__a") + "\n"
            + "    </div>\n"
            + f'    <blockquote class="motto"><p>{MOTTO[0]}</p><footer>{MOTTO[1]}</footer></blockquote>\n')


def care_section():
    groups = "".join(f'<li class="care"><h3>{t}</h3>{_ul(items)}</li>' for t, items in CARE)
    partners = "".join(f"<li>{p}</li>" for p in PARTNERS)
    dance = "".join(f"<li><b>#{i + 1} {t}</b> {d}</li>" for i, (t, d) in enumerate(ONLINE["dance"]))
    return (_head("audition care", "1:1 맞춤형 집중 케어", "care")
            + '    <div class="care-wrap">\n'
            + f'      <ul class="cares">{groups}</ul>\n'
            + '      <div class="care-photos">' + _photo("seminar", "매달 하는 오디션 세미나", "snap--tilt-r")
            + _photo("audition-board", "학원 내방 오디션 공지", "snap--tilt-l") + "</div>\n"
            + "    </div>\n"
            + '    <div class="partners"><p>실제 엔터 관계자가 추천한 제휴 업체로 전문가 케어까지</p>'
            + f'<ul class="card__chips">{partners}</ul></div>\n'
            + '    <article class="card card--paper online">\n'
            + '      <p class="card__name">온라인 레슨 <span>보컬 + 댄스</span></p>\n'
            + f'      <p>{ONLINE["lead"]}</p>\n'
            + f'      <h4>댄스 강의 커리큘럼 (총 16강)</h4><ul class="online__dance">{dance}</ul>\n'
            + "    </article>\n")


def results_section():
    debuts = "".join(f'<li class="debut"><b>{g}</b>{f"<span>{n}</span>" if n else ""}<small>{t}</small></li>'
                      for g, n, t in DEBUTS)

    def cards(rows):
        return "".join(f'<li class="agency"><h4>{n}</h4>{_ul(r)}</li>' for n, r in rows)
    first, rest = AGENCIES[:15], AGENCIES[15:]
    schools = "".join(f'<div class="card__col"><h4>{t}</h4>{_ul(items)}</div>' for t, items in SCHOOLS)
    recent = "".join(f"<li>{r}</li>" for r in RECENT_2025)
    total = len(AGENCIES) + len(SHOWS)
    return (_head("results", "합격 소식", "results")
            # ids/data-*: js/passboard.js adds the 합격 소식 posted in the admin page (audition_news) to this board
            + f'    <ul class="debuts" id="passDebuts">{debuts}</ul>\n'
            + '    <ul class="stats">'
            + f'<li><b data-pass-total="{total}">{total}곳+</b><span>합격 기획사 · 방송</span></li>'
            + '<li><b>3주</b><span>최단 기간 대형 기획사 합격</span></li>'
            + '<li><b>9만+</b><span>유튜브 구독자</span></li></ul>\n'
            + '    <div id="passYears"><div class="pass-year" data-year="2025">\n'
            + '    <h3 class="scrap__sub">2025 합격 소식</h3>\n'
            + f'    <ul class="card__chips card__chips--light">{recent}</ul>\n'
            + '    </div></div>\n'
            + '    <h3 class="scrap__sub">기획사 오디션</h3>\n'
            + f'    <ul class="agencies" id="passAgencies">{cards(first)}</ul>\n'
            + f'    <details class="more"><summary>기획사 {len(rest)}곳 더 보기</summary><ul class="agencies" id="passAgenciesMore">{cards(rest)}</ul></details>\n'
            + '    <h3 class="scrap__sub">방송 · 프로그램</h3>\n'
            + f'    <ul class="agencies" id="passShows">{cards(SHOWS)}</ul>\n'
            + '    <h3 class="scrap__sub" id="schools">입시</h3>\n'
            + f'    <article class="card card--paper" id="passSchools"><div class="card__cols">{schools}</div></article>\n'
            + '    <p class="scrap__note">합격한 학생 이름은 싣지 않았어요. 그동안의 합격 소식은 <a href="results.html">results</a>에서 볼 수 있어요.</p>\n')


def rooms_section():
    snaps = "".join(_photo(n, c, f"snap--{w}" if w else "") for n, c, w in ROOM_PHOTOS)
    return (_head("rooms", "새벽 2시에도 열려 있는 연습실", "rooms")
            + f'    <p class="scrap__lede">{ROOM_LINE}</p>\n'
            + "    " + _ul(ROOM_FACTS, "facts") + "\n"
            + f'    <div class="gallery">{snaps}</div>\n'
            + '    <p class="scrap__cta"><a class="pill-btn pill-btn--light" href="booking.html">빈 시간 보기 → 연습실 예약</a></p>\n')


def tips_section():
    tips = "".join(f'<li><a href="post.html?id={n}">{t}</a></li>' for t, n in TIPS)  # moved from the blog
    links = [("유튜브 · 보컬 레슨", YT), ("유튜브 · 오디션 채널", YT_AUDITION), ("인스타그램", INSTA_AUDITION)]
    chips = "".join(f'<li><a href="{u}" target="_blank" rel="noopener">{t} ↗</a></li>' for t, u in links)
    return (_head("one-point lesson", "원포인트 레슨", "tips")
            + f'    <ul class="tips">{tips}</ul>\n'
            + '    <p class="scrap__note"><a href="tips.html">원포인트 레슨 영상 전체 보기 →</a></p>\n'
            + f'    <ul class="channels">{chips}</ul>\n')


def about_sections():
    index = [("teacher", "선생님"), ("steps", "커리큘럼"), ("why", "특징"), ("care", "오디션 케어"),
             ("results", "합격 소식"), ("rooms", "연습실"), ("tips", "원포인트 레슨")]
    chips = "".join(f'<li><a href="#{a}">{t}</a></li>' for a, t in index)
    blocks = [teacher_section(), steps_section(), why_section(), care_section(), results_section(), rooms_section(), tips_section()]
    return ('<section class="scrap" aria-label="이송희보컬레슨 자세히 보기">\n'
            f'  <nav class="scrap__index" aria-label="이 페이지 목차"><ul>{chips}</ul></nav>\n'
            + "".join(f'  <div class="scrap__block">\n{b}  </div>\n' for b in blocks)
            + "</section>\n")


def find_us_section():
    steps = "".join(f"<li>{s}</li>" for s in DIRECTIONS["steps"])
    links = [("카카오톡 채널 (24시간 상담)", "https://pf.kakao.com/_xgNYbK"), ("유튜브", YT), ("유튜브 · 오디션 채널", YT_AUDITION),
             ("인스타그램", INSTA_AUDITION)]
    chips = "".join(f'<li><a href="{u}" target="_blank" rel="noopener">{t} ↗</a></li>' for t, u in links)
    return ('<section class="scrap scrap--paper" aria-label="오시는 길">\n'
            '  <div class="scrap__block">\n'
            + _head("find us", "오시는 길", "map")
            + '    <div class="findus">\n'
            + '      ' + _photo("map", "오시는 길 약도", "snap--map") + "\n"
            + '      <div>\n'
            + f'        <p class="findus__addr">{DIRECTIONS["address"]}</p>\n'
            + f'        <p>{DIRECTIONS["subway"]}</p>\n'
            + f'        <ol class="findus__steps">{steps}</ol>\n'
            + '        <p>전화 · 문자 상담 <a href="tel:01044585448">010-4458-5448</a> · 카카오톡 채널 24시간 문의 · 무료 방문 상담</p>\n'
            + "      </div>\n"
            + "    </div>\n"
            + f'    <ul class="channels">{chips}</ul>\n'
            + "  </div>\n"
            "</section>\n")
