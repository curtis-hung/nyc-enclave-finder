from pipeline import cli


def test_cli_fetch_accepts_refresh():
    assert cli.main(["fetch", "--only", "none"]) == 0
