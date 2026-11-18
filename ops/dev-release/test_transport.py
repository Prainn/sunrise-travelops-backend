import io
import json
from pathlib import Path
from types import SimpleNamespace
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import client
import receiver


class DevTargetTests(unittest.TestCase):
    def test_uncertain_activation_reads_target_once_without_repeating_mutation(self):
        with patch.object(client, 'call', side_effect=[SystemExit(255), {'current': 'wanted'}]) as rpc:
            result = client.activate('backend', ['rollback', 'wanted', 'prior'], 'wanted')
        self.assertTrue(result['verified'])
        self.assertEqual(rpc.call_count, 2)
        self.assertEqual(rpc.call_args.args, ('backend', 'status'))

    def test_timed_out_activation_with_another_live_release_is_not_verified(self):
        with patch.object(client, 'call', side_effect=[subprocess.TimeoutExpired('ssh', 1), {'current': 'other'}]):
            with self.assertRaisesRegex(RuntimeError, 'unconfirmed'):
                client.activate('frontend', ['deploy'], 'wanted')

    def test_stale_backend_state_is_rejected_even_when_container_is_healthy(self):
        mod = SimpleNamespace(API_CONTAINER='api', read_state=lambda: {'current': 'one', 'previous': None},
                              release=lambda _: {'status': 'verified', 'image': 'old'},
                              run=lambda _: 'new healthy')
        with self.assertRaisesRegex(ValueError, 'differs'):
            receiver.status(mod, 'backend')


if __name__ == '__main__':
    unittest.main()
