import numpy as np
import pytest

from pipeline.build.diversity import entropy


def test_entropy_is_zero_for_one_category_and_one_for_equal_mix():
    one = entropy(np.array([[100.0], [0], [0], [0]]), np.array([100.0]), 4)
    equal = entropy(np.array([[25.0], [25], [25], [25]]), np.array([100.0]), 4)
    assert one[0] == pytest.approx(0)
    assert equal[0] == pytest.approx(1)


def test_entropy_does_not_depend_on_category_order():
    a = entropy(np.array([[70.0], [20], [10]]), np.array([100.0]), 3)
    b = entropy(np.array([[10.0], [70], [20]]), np.array([100.0]), 3)
    assert a[0] == pytest.approx(b[0])
