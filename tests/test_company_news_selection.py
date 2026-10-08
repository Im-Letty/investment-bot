import unittest

from company_news_selection import priority, candidate_order


class CompanySelectionTests(unittest.TestCase):
    def test_material_categories_are_not_share_price_predictions(self):
        for title, category in [('会社買収について', 'business_change'),
                                ('通期業績予想の下方修正', 'earnings_change'),
                                ('新工場を建設', 'investment'),
                                ('資本提携を発表', 'partnership'),
                                ('新サービスを提供開始', 'new_service'),
                                ('新たな材料を開発', 'research')]:
            self.assertEqual(priority(title)[1], category)
        self.assertEqual(priority('株価上昇を予想'), (0, None))

    def test_product_adoption_is_distinct_from_recruitment(self):
        self.assertEqual(priority('新しい圧縮機が工場向けに採用')[1], 'investment')
        self.assertEqual(priority('新卒採用のお知らせ'), (0, None))

    def test_routine_publicity_and_vague_titles_do_not_fill_slots(self):
        for title in ['新製品の受賞', '新しい事業の説明会', '最新技術のフォーラムを開催',
                      '役員人事のお知らせ', '自己株式の取得状況', '新製品発売キャンペーン',
                      '会社のお知らせ', None]:
            self.assertEqual(priority(title), (0, None))

    def test_newer_day_then_priority_then_original_time(self):
        def item(title, day, stamp):
            return dict(title=title, published_date=day, published_at=stamp, symbol='6501.T', url='https://example.test/news')
        old_important = item('会社買収について', '2026-10-07', 200)
        today_research = item('新材料を開発', '2026-10-08', 200)
        today_factory = item('新工場を建設', '2026-10-08', 100)
        later_factory = item('新工場を建設', '2026-10-08', 150)
        self.assertEqual(sorted([old_important, today_research, today_factory, later_factory], key=candidate_order),
                         [later_factory, today_factory, today_research, old_important])
