"""Official news producer with source-isolated writing.

Used by private rehearsals and the bounded website-specific entry point.
Passage IDs prove only that evidence exists in the assigned body, not that the AI's
interpretation is correct. Both independent final reviews remain mandatory.
"""
from copy import deepcopy
import re
import time

import daily_news_producer as shared


EDITORIAL_ACCURACY = '''書く内容ごとに、誰が・何を対象に・何をしたか・どこまで決まったかを原文と照合します。facts.text、見出し、詳細、全体要約すべてに適用します。
合意した事実と、合意した行動の中身を分けます。「協力方法を検討することで合意」を「共同投資を実施することで合意」に短縮してはいけません。
英語のagree/concurは合意、exploreは探る・検討する、encourageは促す、couldは可能性です。単語だけで判定せず、主語と動作の対象を含む文全体を読みます。「協議を促す」は「協議を始める」と同じではありません。「定期会合を可能にする窓口を明らかにする」は会合開催の決定と同じではありません。
複数の施策を一文にまとめるときも、それぞれの「検討する・促す・目指す」を消しません。逆に、明記された署名・開催・合意を一律に「検討」に弱めません。
目標や期待を、すでに起きた効果や決まった予定に変えません。生活への影響や今後の見込みは、本文で確認できなければ無理に付け加えません。
「第1回」はその名称の会合の初回です。両国や参加者が過去に一度も会っていない意味へ広げません。「会合の最後」「定期開催」「開始時刻」など、資料に明記されていない順序・頻度・時刻は補いません。
数値は単位・数える対象・範囲・比較条件と一緒に保ちます。「約20機関の代表者」を「約20人」に変えず、機関数を人数、予算を実際の支出、見込みを実績に置き換えません。短い別案でも「約」「可能性」「検討」など意味を限定する言葉を削りません。
'''

EDITORIAL_READABILITY = '''一文では一つの動きを伝え、目安は40〜60字です。長い説明は句点で分けます。最初に国・会社などの主体と出来事を示し、正式名称の列挙から始めません。
「官民」「二国間」「投資案件」は、対象が一致する場合に「政府と企業」「両国」「投資の計画」のように書きます。語句を機械的に置換せず、資料の意味を保ちます。
公開文では「経済安全保障」「法的拘束力」「サプライチェーン」「官民」を説明なしで使いません。見出しは日常語で書きます。本文で必要なら、最初の語の直後に括弧か「とは」で短い説明を添えます。
この4語は例であり、それ以外の専門語や長い組織名にも同じ方針を適用します。「覚書」「政策・金融関係機関」「重要鉱物」「政府系金融機関」も、主案と簡潔案の両方で説明なしに残しません。名称より、その文書や組織が何をするものかを短く伝えます。
今回の出来事を理解するために不要な参加団体の分類・人数・会場は省きます。すべての専門語に説明を足して字数を埋めず、重要な協力内容を1〜2点選び、留保を保った短い文で説明します。全体要約で参加者や会場を詳しく紹介せず、その分を出来事と目的の説明に使います。
言い換えの例は、対象と意味が原文に一致する場合だけ使います。「投資支援の方策を検討する」は「投資を支える方法を考える」のように書けます。「覚書」は初出で「協力内容をまとめた文書」と説明できます。重要鉱物を残すなら「ものづくりなどに欠かせない鉱物」のようにその意味を短く添えます。政府系金融機関を「国がつくった銀行」と一律に置き換えず、組織の範囲や役割を変えません。
例えば経済安全保障は「経済の面から国の安全を守ること」。この一般的な言い換えから、資料にない具体策や効果を足しません。本文が具体策を説明しているなら、その動作を平易に伝える方を優先します。
「法的な義務を生じさせない」を「守らなくても罰金なし」、「供給網を強くする」を「品不足がなくなる」に変えてはいけません。目的や意味の範囲が変わります。
文字数は200〜300字、目標230〜260字です。初稿から範囲を確認します。文字数のために日付・正式名称・同じ説明・未確認の予想を足しません。
'''

# This small copy rule spots unexplained terms, not factual truth or reading age.
# An inline gloss still needs both independent semantic reviews.
EXPLANATION_TERMS = ('経済安全保障', '法的拘束力', 'サプライチェーン', '官民',
                     '覚書', '政策・金融関係機関', '重要鉱物', '政府系金融機関')

SUMMARY_OPTIONS = '''summaryは約250字の完成稿にし、summary_alternativesに約220字の簡潔な完成稿を1本入れます。どちらも200〜300字を目指します。別案も途中で切れない独立した全文です。
見出し・記事番号・facts・根拠番号・選んだ記事は共通で変えません。追加の別案は最大2本までです。文や段落の部品を返したり、情報を別案に分散させたりしません。
各案は同じ出来事・対象・単位・条件を保ち、詳細ならそれぞれ2段落にします。短くする際も留保を落とさず、未確認の効果を足しません。JSONの既存項目にsummary_alternatives:["簡潔な完成稿全文"]だけを追加してください。
返す前に、見出し・summary・簡潔案をそれぞれ初めて読む中学生のつもりで読み直します。説明なしの専門語、長い組織名の列挙、長い一文を残しません。短い言い換えで検討・方針・目的を実施や確定した効果に変えていないかも確認します。
'''


def _unexplained_terms(value):
    result = []
    for term in EXPLANATION_TERMS:
        if term in value['headline']:
            result.append(term)
            continue
        position = value['summary'].find(term)
        if position < 0:
            continue
        following = value['summary'][position + len(term):].lstrip()
        # Only the first use within this independently readable summary counts.
        if not re.match(r'(?:（[^（）\n。]{4,60}）|\([^()\n。]{4,60}\)|とは[^\n。]{4,60}。)', following):
            result.append(term)
    return result


ARTICLE_TASK = '''今回は1記事だけを整理します。入力articlesの1件以外を根拠にしません。
failed_checksがあれば前稿のその観点を原文から見直します。前稿の内容を事実として扱わず、根拠のない条件や難しい表現を取り除いてください。
他の記事と同じ相手国・同じ発表日でも、条件や記念年を共通だと推測しません。
確認済みの事実を、概要用の核心と詳細用の追加情報に分けます。
factsは概要用の核心を2〜8件、通常は2件にします。「誰が何をしたか」と「何が目的か」を中心にします。具体的な窓口・会議の運営・参加者数は詳細に残し、概要用factsへ全情報を並べません。ただし核心の意味を限定する条件は省きません。各textは主語・対象・条件を保ち、evidence_idsに根拠となるevidence_passagesのidを1〜3個選びます。必要な条件が別の部分にあれば両方のidを選びます。引用文そのものは書き写しません。
factsを先に選び、summaryには別の説明材料を残します。factsだけを順に言い直したsummaryは作りません。
summaryは詳細です。単独で読める短い導入のあとに、具体的な方法・条件・補足を説明する2段落、合計200〜300字にします。第1段落・第2段落とも110〜130字を目標に、各段落で確認済みの事実を短い3文ほどに分けます。導入の1文で核心を再掲した後は、factsに選んでいない資料中の具体的な手順・対象・期間・条件などへ進みます。一方の段落だけ短い導入にして合計200字を下回らないようにします。全体は220〜260字を目指します。
見出しは主体と具体的な動作を15〜35字で表し、検討・合意・実施を区別します。目的を投資・事業そのものの種類や達成済みの効果のように修飾しません。例えば「国の安全を守るために投資の協力を強める」を、新種の「国の安全を守る投資」と呼び替えません。見出しは「投資での協力方針に署名」のように確認できる動作に絞り、目的は本文で説明します。確認できない影響や用語の定義で字数を埋めません。
見出しも本文も、初めて読む人に説明する「です・ます」の日常語にします。「法的拘束力」「サプライチェーン」「官民」のような言葉をそのまま並べません。制度名を推測で定義せず、その資料で確認できた具体的な動作に言い換えます。
記念の年や会合の正式名称、参加者の役職は、今回の動きを理解するのに不可欠な場合以外は省きます。
番号は根拠確認用で公開本文ではありません。入力にない番号や別の記事の番号を作らず、indexは入力の整数のまま返します。
JSONのみ：{"index":0,"facts":[{"text":"主語と対象を含む概要用の事実","evidence_ids":["0:0"]},{"text":"目的や核心の意味を限定する条件","evidence_ids":["0:0"]}],"headline":"...","summary":"導入と説明。\\n\\n追加情報。","summary_alternatives":["簡潔な導入と説明。\\n\\n必要な条件と追加情報。"]}。
'''

OVERVIEW_TASK = '''今回は全体の見出しと要約だけを作ります。詳細を書き換えてはいけません。
article_cardsは出典ごとに分けた未審査の草稿と根拠です。各factsの内容を、そのindexの主語・対象・条件に限定してまとめます。
ある文書の「法的な拘束力がない」「記念年」「終了条件」を、別の文書・会合にも当てはめてはいけません。共通の条件や因果関係は推測しません。
同じ出来事のカードは1件だけを選び、別々の出来事は最大3件まで。indexesは実際に要約したカードのindexを返します。件数合わせは不要です。
全体summaryは200〜300字、目標220〜250字。2記事ならそれぞれ100〜125字、各2文を目安にします。3記事なら各70〜80字、1記事なら核心と目的を合わせて220〜250字です。出力は分割せず一つのsummaryにします。
何が起きたか・何が目的かを中心にし、details用のsummaryを長く繰り返しません。各記事を紹介する前の総論や、最後の言い直しは不要です。会議の参加者数や窓口・手続きなど詳細の補足はここで列挙せず、核心を理解するために必要な条件だけ残します。確認できる影響だけを含めます。
月単位の総論を書いてから同じ出来事を日付付きで再説明しません。各出来事の主体・動作・目的は一度だけ述べ、日付を残すならその出来事を最初に説明する文にまとめます。
カードのquotesで確認できない説明を足さず、見出しや制度名から内容を推測しません。
JSONのみ：{"headline":"全体見出し","summary":"全体の要約","indexes":[0,1],"summary_alternatives":["同じ記事と条件を保った簡潔な全体要約"]}。
'''

SCOPED_REVIEW = '''
article_evidenceは草稿を作る際の根拠候補であり、審査済みの事実ではありません。
各詳細の根拠は、そのindexに一致するoriginal_articlesの本文だけです。
他の記事にある条件・記念年・実施予定を根拠に、その詳細を承認しないでください。
全体要約でも主語と条件の対応を確認し、一つの文書の条件を複数の文書の共通条件にしていないか確認してください。
原文に引用が存在するだけでは内容の裏付けになりません。引用の文脈と本文全体を照合してください。
facts.textや全体要約で、合意した行動の対象や確実さが変わっていないかを確認します。「検討することで合意」は「実施することで合意」と同じではありません。署名・会合の開催など原文に明記された実施は実施のまま扱います。
agree/concurの有無だけで合否を決めず、explore/encourage/couldなどを含む動作全体を照合します。非拘束的な文書にも合意した方針はあり得るため、「法的な義務がない」だけで合意の記述を誤りとはしません。
公開文の専門用語に説明があっても、その意味が正しいかは別に照合します。一般的な語の説明を、その会合で確認された効果や具体策と取り違えないでください。
数値と単位・対象・留保を照合します。「約20機関の代表者」を「約20人」に変えるなど、同じ数値でも数える対象や確実さが変わっていればfactsで指摘します。
'''

VALIDATION_HELP = {
    'isolated_article_schema': 'JSONの必須項目はindex・headline・summary・factsです。任意のsummary_alternativesは完成文の文字列1〜2本だけで、それ以外の項目は追加しません。indexは入力記事の整数を変えず、見出しは80字以内の文字列にします。',
    'isolated_article_length': 'summaryの実測文字数が範囲外です。measured_charactersを確認し、引用や見出しを除くsummaryだけで200〜300字、目標250字になるよう書き直します。資料にない話は足しません。',
    'isolated_article_paragraphs': 'summaryは空行で区切った2段落にします。JSONのsummary文字列に改行を2個（\\n\\n）入れ、単独で読める導入と追加情報に分けます。',
    'isolated_article_evidence': 'factsはtextとevidence_idsだけを持つ2〜8件です。evidence_idsには、入力evidence_passagesにあるid文字列を1〜3個そのまま選びます。本文に引用を書き写す必要はありません。選んだ部分がtextの主語・条件の根拠になっているか確認し、別の記事の番号や条件は使いません。',
    'isolated_article_readability': 'unexplained_termsは説明なしに残った言葉です。見出しは日常語にし、本文は意味を変えずに言い換えるか、最初の語の直後に括弧か「とは」で短く説明します。元の本文にない具体策や効果は補いません。',
    'isolated_overview_schema': 'JSONの必須項目はheadline・summary・indexesです。任意のsummary_alternativesは完成文の文字列1〜2本だけです。詳細本文や他の項目を追加せず、見出しは80字以内にします。',
    'isolated_overview_selection': 'indexesは渡されたカードのindexを整数のまま使い、実際に扱う1〜3件を重複なく並べます。',
    'isolated_overview_length': 'summaryの実測文字数が範囲外です。measured_charactersを確認し、200〜300字、目標250字になるよう書き直します。カードの根拠にない情報で埋めません。',
    'isolated_overview_repeated': '全体と詳細が同じ文章です。全体は出来事の核心と目的に絞り、詳細の具体的な方法・条件を長く繰り返さないよう書き直します。',
    'isolated_overview_readability': '全体要約だけを読む人にも伝わるように、unexplained_termsの言葉を日常語にします。必要な語は最初の直後に括弧か「とは」で説明します。詳細に説明があっても、全体要約で説明を省きません。',
}


def _normalized(text):
    return re.sub(r'\s+', ' ', text).strip()


def _text(value, minimum, maximum, code):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise shared.GenerationError(code)
    return value.strip()


def _passages(source):
    """Give exact source spans local IDs; no AI copying/normalizing originals."""
    body, start, result = source['body'], 0, []
    while start < len(body):
        end = min(start + 900, len(body))
        if end < len(body):
            # Prefer a line/word boundary, retaining every character exactly.
            boundary = max(body.rfind('\n', start + 450, end), body.rfind(' ', start + 450, end),
                           body.rfind('。', start + 450, end))
            if boundary >= start + 450:
                end = boundary + 1
        result.append({'id': f'{source["index"]}:{len(result)}', 'text': body[start:end]})
        start = end
    return result


def _article_common(value, source):
    """Resolve IDs within one immutable body; generated quotes are not accepted."""
    if (not isinstance(value, dict) or set(value) != {'index', 'headline', 'summary', 'facts'}
            or type(value['index']) is not int or value['index'] != source['index']):
        raise shared.GenerationError('isolated_article_schema')
    headline = _text(value['headline'], 1, 80, 'isolated_article_schema')
    facts = value['facts']
    if not isinstance(facts, list) or not 2 <= len(facts) <= 8:
        raise shared.GenerationError('isolated_article_evidence')
    passages, clean = {row['id']: row['text'] for row in _passages(source)}, []
    for fact in facts:
        if not isinstance(fact, dict) or set(fact) != {'text', 'evidence_ids'}:
            raise shared.GenerationError('isolated_article_evidence')
        claim = _text(fact['text'], 1, 500, 'isolated_article_evidence')
        ids = fact['evidence_ids']
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 3
                or any(not isinstance(key, str) or key not in passages for key in ids)
                or len(set(ids)) != len(ids)):
            raise shared.GenerationError('isolated_article_evidence')
        clean.append({'text': claim, 'evidence_ids': list(ids), 'quotes': [passages[key] for key in ids]})
    # Source identity and dates are supplied by code, never generated by AI.
    ref = {key: source[key] for key in ('index', 'source', 'title', 'url', 'published_at',
           'published_date', 'publication_precision', 'body_sha256', 'body_verified_at')}
    return {'index': source['index'], 'headline': headline,
            'facts': clean, 'source_ref': ref}


def _single_card(value, source):
    common = _article_common(value, source)
    summary = _text(value['summary'], 200, 300, 'isolated_article_length')
    paragraphs = re.split(r'\n\s*\n', summary)
    if len(paragraphs) != 2 or any(not part.strip() for part in paragraphs):
        raise shared.GenerationError('isolated_article_paragraphs')
    if _unexplained_terms({'headline': common['headline'], 'summary': summary}):
        raise shared.GenerationError('isolated_article_readability')
    return {**common, 'summary': summary}


def _overview_common(value, cards):
    if (not isinstance(value, dict) or set(value) != {'headline', 'summary', 'indexes'}
            or not isinstance(value['indexes'], list) or not 1 <= len(value['indexes']) <= len(cards)):
        raise shared.GenerationError('isolated_overview_schema')
    indexes = value['indexes']
    allowed = {card['index']: card for card in cards}
    if (any(type(index) is not int or index not in allowed for index in indexes)
            or len(set(indexes)) != len(indexes)):
        raise shared.GenerationError('isolated_overview_selection')
    headline = _text(value['headline'], 1, 80, 'isolated_overview_schema')
    return headline, indexes, allowed


def _single_draft(value, cards):
    headline, indexes, allowed = _overview_common(value, cards)
    summary = _text(value['summary'], 200, 300, 'isolated_overview_length')
    if _unexplained_terms({'headline': headline, 'summary': summary}):
        raise shared.GenerationError('isolated_overview_readability')
    if any(_normalized(summary) == _normalized(allowed[index]['summary']) for index in indexes):
        raise shared.GenerationError('isolated_overview_repeated')
    return {'headline': headline, 'summary': summary,
            'articles': [{key: allowed[index][key] for key in ('index', 'headline', 'summary')}
                         for index in indexes]}


def select_response(value, *, source=None, cards=None):
    """Select one complete locally valid summary; no semantic approval implied.

    Legacy single-summary responses remain accepted. Only the first eligible
    full text is selected, without truncation or sentence/paragraph assembly.
    Fixed failures carry a text-free candidate_report for private diagnostics.
    """
    if (source is None) == (cards is None):
        raise shared.GenerationError('invalid_article_selection')
    stage = 'article' if source is not None else 'overview'
    schema_error = 'isolated_' + stage + '_schema'
    fields = {'index', 'headline', 'summary', 'facts'} if source is not None else {'headline', 'summary', 'indexes'}
    report = {'selected_candidate_index': None, 'candidate_checks': []}
    candidates = []
    if isinstance(value, dict):
        candidates = [value.get('summary')]
        alternatives = value.get('summary_alternatives')
        if isinstance(alternatives, list):
            candidates.extend(alternatives[:2])
    for index, text in enumerate(candidates):
        text = text.strip() if isinstance(text, str) else ''
        report['candidate_checks'].append({'candidate_index': index, 'summary_characters': len(text),
            'summary_paragraphs': len(re.split(r'\n\s*\n', text)) if text else 0,
            'validation_status': 'invalid'})

    def fail(code, *, common=False):
        if common:
            for row in report['candidate_checks']:
                row.update(validation_status='invalid', validation_error=code)
        error = shared.GenerationError(code)
        error.candidate_report = deepcopy(report)
        raise error

    if not isinstance(value, dict) or set(value) not in (fields, fields | {'summary_alternatives'}):
        fail(schema_error, common=True)
    if 'summary_alternatives' in value:
        alternatives = value['summary_alternatives']
        if (not isinstance(alternatives, list) or not 1 <= len(alternatives) <= 2
                or any(not isinstance(text, str) for text in alternatives)):
            fail(schema_error, common=True)
    # A malformed primary summary is not an envelope that alternatives can fix.
    if not isinstance(value['summary'], str):
        fail('isolated_' + stage + '_length', common=True)
    base = {key: deepcopy(value[key]) for key in fields}
    try:
        if source is not None:
            _article_common(base, source)
        else:
            _overview_common(base, cards)
    except shared.GenerationError as error:
        fail(str(error), common=True)
    chosen = None
    for text, row in zip(candidates, report['candidate_checks']):
        response = {**deepcopy(base), 'summary': text}
        try:
            validated = _single_card(response, source) if source is not None else _single_draft(response, cards)
        except shared.GenerationError as error:
            row['validation_error'] = str(error)
        else:
            row['validation_status'] = 'valid'
            if chosen is None:
                chosen = {**response, 'headline': validated['headline'], 'summary': validated['summary']}
                report['selected_candidate_index'] = row['candidate_index']
    if chosen is None:
        fail(report['candidate_checks'][0]['validation_error'])
    return chosen, report


def _card(value, source):
    selected, _ = select_response(value, source=source)
    return _single_card(selected, source)


def _draft(value, cards):
    selected, _ = select_response(value, cards=cards)
    return _single_draft(selected, cards)


def _reserve(providers, calls):
    """Require the private harness's transport budget before any paid writing."""
    shared._check_deadline()
    reserve = getattr(providers, 'reserve_drafting', None)
    if not callable(reserve):
        raise shared.GenerationError('isolated_budget_required')
    reserve(calls)
    shared._check_deadline()


def _claude(providers, instruction, data, calls_left):
    _reserve(providers, calls_left)
    result = providers.claude(instruction, deepcopy(data))
    shared._check_deadline()
    return result


def _article(source, context, providers, calls_left, *, previous=None, failed=()):
    # No complete edition or free-form reviewer prose enters this context.
    # Reviewer prose may itself mention another article's unsupported condition.
    data = {**deepcopy(context), 'stage': 'article', 'articles': [deepcopy(source)],
            'evidence_passages': _passages(source),
            'failed_checks': list(failed)}
    if previous is not None:
        data['previous_draft'] = {key: deepcopy(previous[key])
                                  for key in ('index', 'headline', 'summary', 'facts')}
        data['previous_draft']['facts'] = [{key: deepcopy(fact[key]) for key in ('text', 'evidence_ids')}
                                            for fact in previous['facts']]
    instruction = (shared._edition_context(context['edition_date']) + shared.WRITER_SOURCE
                   + shared.WRITER_STYLE + EDITORIAL_ACCURACY + EDITORIAL_READABILITY + ARTICLE_TASK + SUMMARY_OPTIONS)
    validation_error = None
    for attempt in range(2):
        try:
            value = _claude(providers, instruction, data, calls_left)
        except shared.GenerationError as error:
            # A refused repair must retain the reason the first draft failed.
            # Do not turn a length/evidence failure into a misleading budget
            # diagnosis merely because there is no room for its correction.
            if str(error) == 'generation_call_limit' and validation_error is not None:
                raise validation_error from error
            raise
        try:
            return _card(value, source)
        except shared.GenerationError as error:
            validation_error = error
            if attempt:
                raise
            # Do not replay arbitrary output (e.g. fake articles/instructions).
            # Length feedback is numeric; reconstruction still sees only its source.
            data['validation_error'] = str(error)
            data['validation_instruction'] = VALIDATION_HELP[str(error)]
            data['measured_characters'] = (len(value['summary'].strip())
                if isinstance(value, dict) and isinstance(value.get('summary'), str) else 0)
            data['candidate_checks'] = deepcopy(error.candidate_report['candidate_checks'])
            if str(error) == 'isolated_article_readability':
                data['unexplained_terms'] = _unexplained_terms(value)
    raise AssertionError('unreachable')


def _overview(cards, context, providers, *, previous=None, failed=()):
    data = {**deepcopy(context), 'stage': 'overview', 'article_cards': deepcopy(cards),
            'failed_checks': list(failed)}
    if previous is not None:
        data['previous_overview'] = {key: previous[key] for key in ('headline', 'summary')}
    instruction = (shared._edition_context(context['edition_date']) + shared.WRITER_SOURCE
                   + shared.WRITER_STYLE + EDITORIAL_ACCURACY + EDITORIAL_READABILITY + OVERVIEW_TASK + SUMMARY_OPTIONS)
    validation_error = None
    for attempt in range(2):
        try:
            value = _claude(providers, instruction, data, 1)
        except shared.GenerationError as error:
            if str(error) == 'generation_call_limit' and validation_error is not None:
                raise validation_error from error
            raise
        try:
            return _draft(value, cards)
        except shared.GenerationError as error:
            validation_error = error
            if attempt:
                raise
            data['validation_error'] = str(error)
            data['validation_instruction'] = VALIDATION_HELP[str(error)]
            data['measured_characters'] = (len(value['summary'].strip())
                if isinstance(value, dict) and isinstance(value.get('summary'), str) else 0)
            data['candidate_checks'] = deepcopy(error.candidate_report['candidate_checks'])
            if str(error) == 'isolated_overview_readability':
                data['unexplained_terms'] = _unexplained_terms(value)
    raise AssertionError('unreachable')


def generate_isolated_edition(now=None, *, articles, source_window, providers=None, clock=time.time):
    """Source-isolated writing with the frozen evidence/publication contract."""
    token = shared._generation_deadline.set(time.monotonic() + shared.GENERATION_BUDGET_SECONDS)
    try:
        shared._check_deadline()
        result = _generate(now, articles, source_window, providers, clock)
        shared._check_deadline()
        return result
    finally:
        shared._generation_deadline.reset(token)


def _generate(now, articles, source_window, providers, clock):
    now = clock() if now is None else now
    window = shared._source_window(source_window, now)
    frozen = shared._official_articles(articles, window, now)
    edition = window['edition_date']
    context = {'edition_date': edition, 'source_window': deepcopy(window)}
    # Preparation already provides deterministic date/source/URL order. This is
    # a bounded candidate set, not a claim to rank every release by importance.
    sources = [{**deepcopy(article), 'index': index} for index, article in enumerate(frozen)][:3]
    cards = []
    for position, source in enumerate(sources):
        cards.append(_article(source, context, providers, len(sources) - position + 1))
    draft = _overview(cards, context, providers)
    instruction = (shared._edition_context(edition) + shared.REVIEW
                   + shared.OFFICIAL_EDITORIAL + SCOPED_REVIEW)
    for attempt in range(2):
        # Validate the same content that will be published before buying reviews.
        issue = shared.build_issue(draft, frozen, clock(), source_window=window)
        if issue['edition_date'] != edition:
            raise shared.GenerationError('edition_day_changed')
        selected = {row['index'] for row in draft['articles']}
        selected_sources = [source for source in sources if source['index'] in selected]
        selected_cards = [card for card in cards if card['index'] in selected]
        review_data = {**deepcopy(context), 'draft': deepcopy(draft),
                       'original_articles': deepcopy(selected_sources),
                       'article_evidence': deepcopy(selected_cards)}
        failed = set()
        rejected = False
        for name in ('gemini', 'openai'):
            shared._check_deadline()
            review = getattr(providers, name)(instruction, deepcopy(review_data))
            shared._check_deadline()
            if not shared.review_valid(review):
                raise shared.GenerationError('invalid_provider_json')
            if not shared.review_passed(review):
                rejected = True
                failed.update(key for key in shared.CHECKS if review['checks'][key] is False)
        if not rejected:
            issue = shared.build_issue(draft, frozen, clock(), source_window=window)
            if issue['edition_date'] != edition:
                raise shared.GenerationError('edition_day_changed')
            return issue
        if attempt:
            raise shared.GenerationError('isolated_editorial_review_failed')
        failed = tuple(key for key in shared.CHECKS if key in failed)
        if failed == ('distinct_topics',):
            # Rebuild only the overview from one source; never merge evidence.
            cards = selected_cards[:1]
            previous_overview = None
        else:
            # Check the whole repair cost before the first paid rewrite. No
            # fallback to the old multi-source full-draft or length repair.
            try:
                _reserve(providers, len(selected_sources) + 1)
            except shared.GenerationError as error:
                if str(error) == 'generation_call_limit':
                    raise shared.GenerationError('isolated_editorial_review_failed') from error
                raise
            previous = {card['index']: card for card in selected_cards}
            cards = [_article(source, context, providers, len(selected_sources) - i + 1,
                              previous=previous[source['index']], failed=failed)
                     for i, source in enumerate(selected_sources)]
            previous_overview = draft
        try:
            draft = _overview(cards, context, providers, previous=previous_overview, failed=failed)
        except shared.GenerationError as error:
            if str(error) == 'generation_call_limit':
                raise shared.GenerationError('isolated_editorial_review_failed') from error
            raise
    raise AssertionError('unreachable')
