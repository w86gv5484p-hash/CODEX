// Firebase の設定値。
// 下の「ここから」と「ここまで」のあいだの1行を、Firebase の画面に表示される
//   const firebaseConfig = {
//     apiKey: "...",
//     ...
//   };
// のかたまり（const から最後の }; まで）と丸ごと入れ替えてください。
// null のままだと、この端末だけに保存する「お試しモード」で動きます。
// （これらの値は公開されても問題ない識別子です。データは firestore.rules と家族コードで守られます。）

// ▼▼▼ ここから ▼▼▼
const firebaseConfig = null;
// ▲▲▲ ここまで ▲▲▲

window.FAMCAL_FIREBASE = firebaseConfig;
