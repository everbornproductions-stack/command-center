-- Enable foreign key support
PRAGMA foreign_keys = ON;

-- -------------------------------------------------
-- Table: books
-- -------------------------------------------------
CREATE TABLE books (
    book_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    author         TEXT NOT NULL,
    isbn           TEXT UNIQUE,
    published_year INTEGER
);

-- -------------------------------------------------
-- Table: students
-- -------------------------------------------------
CREATE TABLE students (
    student_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name   TEXT NOT NULL,
    last_name    TEXT NOT NULL,
    grade_level  INTEGER
);

-- -------------------------------------------------
-- Table: loans
-- -------------------------------------------------
CREATE TABLE loans (
    loan_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id      INTEGER NOT NULL,
    student_id   INTEGER NOT NULL,
    loan_date    DATE NOT NULL,
    due_date     DATE NOT NULL,
    return_date  DATE,
    FOREIGN KEY (book_id)   REFERENCES books(book_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id)
);

-- -------------------------------------------------
-- Sample data: books (15)
-- -------------------------------------------------
INSERT INTO books (title, author, isbn, published_year) VALUES
('To Kill a Mockingbird',           'Harper Lee',          '9780061120084', 1960),
('1984',                            'George Orwell',       '9780451524935', 1949),
('The Great Gatsby',                'F. Scott Fitzgerald','9780743273565', 1925),
('Pride and Prejudice',             'Jane Austen',         '9781503290563', 1813),
('The Hobbit',                      'J.R.R. Tolkien',      '9780547928227', 1937),
('Harry Potter and the Sorcerer''s Stone','J.K. Rowling','9780590353427',1997),
('The Catcher in the Rye',          'J.D. Salinger',       '9780316769488', 1951),
('The Lion, the Witch and the Wardrobe','C.S. Lewis','9780064471046',1950),
('Moby‑Dick',                       'Herman Melville',     '9781503280786', 1851),
('Little Women',                    'Louisa May Alcott',   '9780147514011', 1868),
('The Chronicles of Narnia',        'C.S. Lewis',          '9780064471195', 1956),
('Anne of Green Gables',            'Lucy Maud Montgomery','9780147514012',1908),
('The Adventures of Tom Sawyer',   'Mark Twain',          '9780143039563', 1876),
('A Tale of Two Cities',            'Charles Dickens',     '9780141439600', 1859),
('The Secret Garden',               'Frances Hodgson Burnett','9780141321134',1911);

-- -------------------------------------------------
-- Sample data: students (8)
-- -------------------------------------------------
INSERT INTO students (first_name, last_name, grade_level) VALUES
('Alice',   'Johnson',   5),
('Bob',     'Smith',     6),
('Carla',   'Diaz',      7),
('David',   'Lee',       8),
('Emily',   'Clark',    10),
('Frank',   'Wright',    9),
('Grace',   'Kim',       7),
('Henry',   'Brown',     6);

-- -------------------------------------------------
-- Sample data: loans (10)
--   - Some returned (return_date filled)
--   - Some overdue (due_date < today, return_date NULL)
--   - Some active (due_date >= today, return_date NULL)
-- -------------------------------------------------
-- Returned loans
INSERT INTO loans (book_id, student_id, loan_date, due_date, return_date) VALUES
(1, 1, '2023-09-01', '2023-09-15', '2023-09-14'),   -- returned on time
(2, 2, '2023-08-20', '2023-09-03', '2023-09-01'),   -- returned early
(3, 3, '2023-07-10', '2023-07-24', '2023-07-25'),   -- returned one day late
(4, 4, '2023-09-20', '2023-10-04', '2023-09-30');   -- returned on time

-- Overdue loans (due date in past, not returned)
INSERT INTO loans (book_id, student_id, loan_date, due_date, return_date) VALUES
(5, 5, date('now','-30 day'), date('now','-15 day'), NULL),   -- overdue
(6, 6, date('now','-20 day'), date('now','-5 day'),  NULL),   -- overdue
(7, 7, date('now','-40 day'), date('now','-25 day'), NULL),   -- overdue

-- Active loans (due date in future, not returned)
INSERT INTO loans (book_id, student_id, loan_date, due_date, return_date) VALUES
(8,  8, date('now','-2 day'),  date('now','+13 day'), NULL),   -- still on loan
(9,  1, date('now','-1 day'),  date('now','+14 day'), NULL),   -- still on loan
(10, 2, date('now','-3 day'),  date('now','+12 day'), NULL);   -- still on loan

-- -------------------------------------------------
-- Query: list overdue loans with student name and book title
-- -------------------------------------------------
SELECT
    l.loan_id,
    s.first_name || ' ' || s.last_name AS student_name,
    b.title AS book_title,
    l.due_date
FROM loans l
JOIN students s ON l.student_id = s.student_id
JOIN books b    ON l.book_id    = b.book_id
WHERE l.return_date IS NULL
  AND l.due_date < date('now')
ORDER BY l.due_date ASC;
