/* 開発側の切り替え設定。一般利用者の保存設定やURLでは変更しません。
 * globe: 現在の地球（既定） / paper: 候補B「和紙の便り」 / town: 候補D「木のまち」
 * 変更するときは style を選び、index.html のこのファイルの ?v= も更新して公開します。
 * 設定はページを開くときに適用。自動・日替わりの切り替えはありません。
 */
window.KNHomeHeroConfig = Object.freeze({ style: 'globe' });
