from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch

from news_cache import JST, load_reviewed_digests, select_daily_news
from publish_news import PublicationError, main, publish


def at(edition, hour, minute=0, second=0):
    return datetime.fromisoformat(edition).replace(hour=hour, minute=minute,
                                                 second=second, tzinfo=JST).timestamp()


def issue(edition="2026-09-23"):
    refs = [{"source": source, "title": title, "url": f"https://example.test/{edition}/{index}",
             "published_at": at(edition,6,index)}
            for index,(source,title) in enumerate((("NHK経済","国内の企業の動き"),("ロイター経済","為替市場の動き")))]
    return {"edition_date":edition,"lang":"ja","publication_mode":"curated",
            "reviewed_at":at(edition,7,30),"publish_at":at(edition,8),
            "headline":"お金の動きは、暮らしにどう関わる？","summary":"文"*240,
            "article_refs":refs,
            "article_summaries":[{**ref,"headline":"記事の内容を簡単に","summary":"詳"*240} for ref in refs]}


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.folder=TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path=Path(self.folder.name)/"news-digests.json"
        self.now=at("2026-09-23",7,40)

    def write(self, values):
        self.path.write_text(json.dumps(values,ensure_ascii=False,indent=1)+"\n",encoding="utf-8")

    def test_creates_utf8_publication_and_returns_metadata_only(self):
        original=issue()
        result=publish(original,self.path,self.now)
        self.assertTrue(result["changed"])
        self.assertTrue(result["written"])
        self.assertEqual(result["article_count"],2)
        self.assertEqual(result["issue_count"],1)
        self.assertNotIn("summary",result)
        self.assertNotIn("headline",result)
        self.assertIn("お金の動き",self.path.read_text(encoding="utf-8"))
        self.assertEqual(load_reviewed_digests(self.path),[original])

    def test_same_edition_replacement_preserves_other_editions_and_same_input_is_noop(self):
        previous={**issue("2026-09-22"),"editor_note":"Keep this metadata"}
        self.write([previous,issue()])
        original_bytes=self.path.read_bytes()
        with patch("publish_news.os.replace") as replace:
            unchanged=publish(issue(),self.path,self.now)
        self.assertFalse(unchanged["changed"])
        self.assertFalse(unchanged["written"])
        replace.assert_not_called()
        self.assertEqual(self.path.read_bytes(),original_bytes)
        revised={**issue(),"headline":"暮らしと経済の新しいまとめ"}
        publish(revised,self.path,self.now)
        saved=json.loads(self.path.read_text())
        self.assertEqual(saved,[previous,revised])

    def test_invalid_input_and_future_review_do_not_modify_published_file(self):
        self.write([issue("2026-09-22")])
        original=self.path.read_bytes()
        bad=[None,[],{**issue(),"summary":"短い"},{**issue(),"publication_mode":None},
             {**issue(),"reviewed_at":self.now+1},
             {**issue(),"article_refs":issue()["article_refs"][:1]},
             {**issue(),"publish_at":at("2026-09-24",8)},
             {**issue(),"publish_at":at("2026-09-23",7)}]
        for invalid in bad:
            with self.subTest(invalid=invalid),self.assertRaises(PublicationError):
                publish(invalid,self.path,self.now)
            self.assertEqual(self.path.read_bytes(),original)

    def test_malformed_existing_data_is_never_overwritten(self):
        for content in ("not json","{}","[null]",json.dumps([issue(),issue()]),
                        json.dumps([{**issue(),"summary":"短い"}])):
            self.path.write_text(content)
            with self.subTest(content=content),self.assertRaises(PublicationError):
                publish(issue(),self.path,self.now)
            self.assertEqual(self.path.read_text(),content)

    def test_check_only_validates_without_creating_or_modifying_any_file(self):
        before=set(Path(self.folder.name).iterdir())
        result=publish(issue(),self.path,self.now,check_only=True)
        self.assertTrue(result["changed"])
        self.assertFalse(result["written"])
        self.assertEqual(set(Path(self.folder.name).iterdir()),before)
        self.write([issue("2026-09-22")])
        previous=self.path.read_bytes()
        publish(issue(),self.path,self.now,check_only=True)
        self.assertEqual(self.path.read_bytes(),previous)

    def test_failed_atomic_replace_keeps_previous_complete_file_and_removes_temporary(self):
        self.write([issue("2026-09-22")])
        previous=self.path.read_bytes()
        with patch("publish_news.os.replace",side_effect=OSError("disk unavailable")):
            with self.assertRaises(OSError):
                publish(issue(),self.path,self.now)
        self.assertEqual(self.path.read_bytes(),previous)
        self.assertEqual(list(Path(self.folder.name).glob(".*.tmp")),[])

    def test_prepared_edition_becomes_visible_exactly_at_eight_japan_time(self):
        previous=issue("2026-09-22")
        self.write([previous])
        publish(issue(),self.path,self.now)
        reviewed=load_reviewed_digests(self.path)
        before=select_daily_news({"news":[]},now=at("2026-09-23",7,59,59),reviewed_digests=reviewed)
        after=select_daily_news({"news":[]},now=at("2026-09-23",8),reviewed_digests=reviewed)
        self.assertEqual(before["digest"]["edition_date"],"2026-09-22")
        self.assertEqual(after["digest"]["edition_date"],"2026-09-23")
        self.assertEqual(after["digest"]["article_refs"],issue()["article_refs"])

    def test_retains_thirty_latest_issues_without_overwriting_a_different_date(self):
        first=datetime(2026,8,24)
        previous=[issue((first+timedelta(days=i)).date().isoformat()) for i in range(30)]
        self.write(previous)
        result=publish(issue(),self.path,self.now)
        self.assertEqual(result["issue_count"],30)
        stored=json.loads(self.path.read_text())
        self.assertEqual(stored,previous[1:]+[issue()])
        before=self.path.read_bytes()
        with self.assertRaises(PublicationError):
            publish(issue("2026-01-01"),self.path,self.now)
        self.assertEqual(self.path.read_bytes(),before)

    def test_concurrent_publishers_keep_both_edition_dates(self):
        errors=[]
        def send(value):
            try:
                publish(value,self.path,self.now)
            except Exception as error:
                errors.append(error)
        threads=[Thread(target=send,args=(issue(date),)) for date in ("2026-09-21","2026-09-22")]
        for thread in threads:thread.start()
        for thread in threads:thread.join(2)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(errors,[])
        self.assertEqual([item["edition_date"] for item in load_reviewed_digests(self.path)],
                         ["2026-09-21","2026-09-22"])

    def test_cli_check_and_error_status_do_not_print_article_contents(self):
        input_path=Path(self.folder.name)/"issue.json"
        input_path.write_text(json.dumps(issue(),ensure_ascii=False),encoding="utf-8")
        output=io.StringIO()
        with patch("publish_news.time.time",return_value=self.now),redirect_stdout(output):
            status=main([str(input_path),"--output",str(self.path),"--check-only"])
        self.assertEqual(status,0)
        self.assertTrue(json.loads(output.getvalue())["check_only"])
        self.assertNotIn(issue()["headline"],output.getvalue())
        self.assertFalse(self.path.exists())
        input_path.write_text("invalid json")
        errors=io.StringIO()
        with redirect_stderr(errors):
            status=main([str(input_path),"--output",str(self.path)])
        self.assertEqual(status,1)
        self.assertFalse(json.loads(errors.getvalue())["ok"])
        self.assertFalse(self.path.exists())


if __name__ == '__main__':
    unittest.main()
