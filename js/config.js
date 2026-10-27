// 사이트 설정. Supabase 프로젝트 주소와 공개 키(anon / publishable)를 넣습니다 (supabase/README.md 참고).
// 공개 키는 홈페이지에 드러나도 되는 키예요. service_role / secret 키는 절대 넣지 마세요.
// 비어 있으면 예약·상담 기능은 꺼지고, 카카오톡 문의 안내로 대신합니다.
window.LEESH = {
  supabaseUrl: "https://lsdmokkecmymtxpmiwbm.supabase.co",
  supabaseKey: "sb_publishable_e65wHiIp1Psl4bNVaeU-cA_Df2VmJ-9",
  kakao: "https://pf.kakao.com/_xgNYbK",
  phone: "010-4458-5448",
  // 카카오 연결 요청 때 학생이 고르는 담당 선생님 (구글시트 수강ID 관리 탭 기준)
  // 레슨 노트 (선생님이 수업마다 적는 기록). 선생님들과 정하기 전까지 꺼둠 — true로 바꾸면 내 폴더·관리자 화면에 다시 나와요.
  lessonNotes: false,
  teachers: ["원장님 (이송희)", "안유정", "양유경", "오은지", "이수빈", "이윤지", "이하섬", "최홍주"]
};
