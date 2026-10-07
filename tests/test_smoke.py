from pipeline import cli


def test_cli_parses_and_runs_build():
    assert cli.main(["build"]) == 0


def test_cli_fetch_accepts_refresh():
    assert cli.main(["fetch", "--refresh", "--only", "none"]) == 0
