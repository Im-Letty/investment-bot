"""One explicit native subscription probe; dry by default, no news or API fallback."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from codex_news_writer import (CodexNewsWriter, LOGIN_TIMEOUT, _ProcessFailure,
    _check_events, _json_loads, _read_answer, _result_bytes)
from daily_news_producer import GenerationError


# Leave a few seconds for bounded process-tree teardown within a 120s CI limit.
CHECK_SECONDS = 115
MAX_WIRE_BYTES = 16 * 1024
MAX_ACK_BYTES = 128
ACK_SCHEMA = {'type': 'object', 'additionalProperties': False,
              'properties': {'status': {'type': 'string', 'enum': ['ok']}},
              'required': ['status']}
PROMPT = (b'Return exactly the JSON object {"status":"ok"}. This is only a '
          b'subscription connectivity check. Do not use tools, commands, files, '
          b'browsing, skills, or other agents. Do not request data or credentials.\n')
SETTINGS = ('forced_login_method="chatgpt"', 'model_provider="openai"',
    'approval_policy="never"', 'web_search="disabled"',
    'sandbox_workspace_write.network_access=false',
    'features.shell_tool=false', 'features.unified_exec=false',
    'features.apps=false', 'features.plugins=false', 'features.hooks=false',
    'features.memories=false', 'features.multi_agent=false', 'features.view_image=false',
    'mcp_servers={}', 'project_doc_max_bytes=0',
    'shell_environment_policy.inherit="none"', 'history.persistence="none"')
ERROR_STATUS = {
    'codex_chatgpt_login_required': 'chatgpt_login_required',
    'codex_writer_configuration': 'configuration_invalid',
    'codex_writer_unavailable': 'subscription_unavailable',
    'codex_writer_timeout': 'subscription_timeout',
    'codex_writer_failed': 'subscription_unavailable',
    'codex_writer_output_limit': 'subscription_invalid_response',
    'codex_writer_invalid_output': 'subscription_invalid_response',
    'codex_writer_tool_use': 'subscription_invalid_response',
}


def configuration():
    """No constructor, process, auth read, or inference in the default path."""
    return {'status': 'dry_run', 'verified': False, 'call_count': 0}


def check_subscription(*, writer_factory=None, monotonic=None):
    """Attempt at most one fixed prompt, reusing the native writer's transport.

    call_count counts attempted model invocations, including failed ones. Login
    status is a separate readonly process and cannot establish live access.
    No model answer, process output, auth data or exception text is returned.
    """
    monotonic = time.monotonic if monotonic is None else monotonic
    writer_factory = CodexNewsWriter if writer_factory is None else writer_factory
    result = {'status': 'subscription_unavailable', 'verified': False, 'call_count': 0}
    deadline, writer = monotonic() + CHECK_SECONDS, None

    def remaining():
        seconds = deadline - monotonic()
        if seconds <= 0:
            raise _ProcessFailure('codex_writer_timeout')
        return seconds

    try:
        # Construction supplies the same allowlisted environment and executable
        # selection as news drafting; it never reads an API-key value.
        writer = writer_factory()
        writer.check_login(timeout=min(LOGIN_TIMEOUT, remaining()))
        remaining()
        with tempfile.TemporaryDirectory(prefix='codex-subscription-check-') as directory:
            os.chmod(directory, 0o700)
            schema_path, answer_path = Path(directory) / 'schema.json', Path(directory) / 'answer.json'
            for path in (schema_path, answer_path):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                    if path == schema_path:
                        json.dump(ACK_SCHEMA, stream, allow_nan=False)
            argv = [writer.executable, '--no-daemon', 'exec', '--ephemeral',
                    '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only',
                    '--color', 'never', '--json', '--output-schema', str(schema_path),
                    '--output-last-message', str(answer_path)]
            for setting in SETTINGS:
                argv.extend(('-c', setting))
            argv.append('-')
            seconds = remaining()
            result['call_count'] = 1
            # The existing runner bounds both pipes/output files and terminates
            # all descendants on success, error, timeout, or cancellation.
            response = writer._runner(argv, input=PROMPT, cwd=directory,
                env=dict(writer.env), timeout=seconds, max_output_bytes=MAX_WIRE_BYTES,
                answer_path=str(answer_path))
            remaining()
            stdout, _stderr = _result_bytes(response, MAX_WIRE_BYTES)
            if response.returncode != 0:
                raise _ProcessFailure('codex_writer_failed')
            _check_events(stdout)
            answer = _read_answer(answer_path)
            if len(answer.encode('utf-8')) > MAX_ACK_BYTES or _json_loads(answer) != {'status': 'ok'}:
                raise _ProcessFailure('codex_writer_invalid_output')
            remaining()
            result.update(status='subscription_verified', verified=True)
    except (GenerationError, _ProcessFailure) as error:
        result['status'] = ERROR_STATUS.get(str(error), 'subscription_unavailable')
    except subprocess.TimeoutExpired:
        result['status'] = 'subscription_timeout'
    except (ValueError, TypeError, UnicodeError):
        result['status'] = 'subscription_invalid_response'
    except Exception:
        result['status'] = 'subscription_unavailable'
    finally:
        if writer is not None:
            try:
                writer.close()
            except Exception:
                pass
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-live', action='store_true',
                        help='permit one bounded native ChatGPT subscription prompt')
    args = parser.parse_args(argv)
    result = check_subscription() if args.check_live else configuration()
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['status'] in ('dry_run', 'subscription_verified') else 1


if __name__ == '__main__':
    raise SystemExit(main())
