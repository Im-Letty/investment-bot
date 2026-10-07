import unittest
from unittest.mock import patch

import website_news_execution as execution
import website_news_producer as legacy


class WebsiteExecutionTests(unittest.TestCase):
    def test_default_is_external_codex_without_any_ai_key_requirement(self):
        env = {"SUPABASE_URL": "https://storage.example", "SUPABASE_KEY": "private-test"}
        value = execution.configuration(env)
        self.assertEqual(value["writer"], "codex")
        self.assertEqual(value["generation_owner"], "external")
        self.assertTrue(value["configured"])
        self.assertIsNone(execution.server_generator(value))
        metadata = execution.configuration_metadata(env)
        self.assertEqual(metadata["writer_provider"], "codex_subscription")
        self.assertNotIn("claude", metadata["models"])
        self.assertNotIn("claude", metadata["limits"]["provider_http_calls"])

    def test_missing_or_bad_selector_never_chooses_paid_writer(self):
        for env in ({}, {"NEWS_WEBSITE_WRITER": "sk-do-not-reflect-this"},
                    {"NEWS_WEBSITE_WRITER": "gemini"}):
            with self.subTest(env=list(env)):
                config = execution.configuration(env)
                self.assertFalse(config["configured"])
                self.assertIsNone(execution.server_generator(config))
                self.assertNotIn("sk-do-not-reflect-this", str(config))
                self.assertNotIn("sk-do-not-reflect-this", str(execution.configuration_metadata(env)))

    def test_paid_legacy_writer_requires_explicit_selector_and_its_configuration(self):
        value = execution.configuration({"NEWS_WEBSITE_WRITER": "claude"})
        self.assertFalse(value["configured"])
        self.assertIn("ANTHROPIC_API_KEY", value["missing"])
        self.assertIs(execution.server_generator(value), legacy.generate_website_edition)
        self.assertEqual(value["generation_owner"], "local")
        self.assertEqual(execution.configuration_metadata({"NEWS_WEBSITE_WRITER": "claude"})
                         ["writer_provider"], "claude_api")

    def test_owner_disable_still_disables_collection(self):
        config = execution.configuration({"DAILY_NEWS_ENABLED": "0",
                 "SUPABASE_URL": "https://storage.example", "SUPABASE_KEY": "private-test"})
        self.assertFalse(config["enabled"])
        self.assertTrue(config["configured"])


if __name__ == "__main__":
    unittest.main()
